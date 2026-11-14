"""Login, signup, password reset, profile, and staff accounts."""

from backend.models import PasswordResetRequest, StaffProfile
from django.contrib.auth import authenticate, get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from ._common import (
    _build_generated_username,
    _build_user_payload,
    _extract_token,
    _find_user_by_email_or_username,
    _get_profile,
    _get_request_sender_label,
    _get_request_user,
    _is_admin_or_owner_user,
    _is_owner_or_dev_user,
    _is_placeholder_username,
    _role_name_for_user,
    _write_action_log,
)
from .recycle import _can_purge_internal_records


@api_view(["POST"])
@permission_classes([AllowAny])
def auth_login(request):
    email = (request.data.get("email") or "").strip()
    password = (request.data.get("password") or "").strip()

    if not email or not password:
        return Response(
            {"success": False, "error": "Username/email and password are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = _find_user_by_email_or_username(email)
    if not user:
        return Response(
            {"success": False, "error": "Invalid username/email or password."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    auth_user = authenticate(username=user.username, password=password)
    if not auth_user:
        return Response(
            {"success": False, "error": "Invalid username/email or password."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if not auth_user.is_active:
        return Response(
            {"success": False, "error": "Account is inactive."},
            status=status.HTTP_403_FORBIDDEN,
        )

    token, _ = Token.objects.get_or_create(user=auth_user)
    profile = _get_profile(auth_user)
    needs_profile_setup = bool(
        profile.must_change_password or not profile.profile_completed
    )
    staff_profile = StaffProfile.objects.filter(user=auth_user).first()
    login_actor = (
        ((staff_profile.nickname or "").strip() if staff_profile else "")
        or (auth_user.get_full_name() or "").strip()
        or (auth_user.username or "").strip()
        or (auth_user.email or "").strip()
        or "User"
    )
    _write_action_log(
        request,
        "login",
        f"{login_actor} logged in",
        metadata={
            "user_id": auth_user.id,
            "email": auth_user.email or "",
        },
    )

    return Response(
        {
            "success": True,
            "token": token.key,
            "user": _build_user_payload(auth_user),
            "needs_profile_setup": needs_profile_setup,
            "profile": {
                "must_change_password": profile.must_change_password,
                "profile_completed": profile.profile_completed,
                "profile_photo_url": profile.profile_photo_url,
            },
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
def auth_signup(request):
    request_user = _get_request_user(request)
    if not request_user or not (
        getattr(request_user, "is_staff", False) or getattr(request_user, "is_superuser", False)
    ):
        return Response(
            {"success": False, "error": "Only admin/owner can create staff accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )

    first_name = (request.data.get("first_name") or "").strip()
    last_name = (request.data.get("last_name") or "").strip()
    username = (request.data.get("username") or "").strip()
    email = (request.data.get("email") or "").strip()
    password = request.data.get("password") or ""
    phone_number = (request.data.get("phone_number") or "").strip()
    nickname = (request.data.get("nickname") or "").strip()
    requested_role = (request.data.get("role") or "STAFF").strip().upper()

    if not first_name or not last_name or not email:
        return Response(
            {
                "success": False,
                "error": "First name, last name, and email are required.",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if requested_role not in {"STAFF", "ADMIN"}:
        return Response(
            {"success": False, "error": "Role must be STAFF or ADMIN."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if requested_role == "ADMIN" and not _is_owner_or_dev_user(request_user):
        return Response(
            {"success": False, "error": "Only owner/superadmin can create ADMIN accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )

    User = get_user_model()
    if User.objects.filter(email__iexact=email).exists():
        return Response(
            {"success": False, "error": "Email already registered."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    generated_username = ""
    if username:
        if User.objects.filter(username__iexact=username).exists():
            return Response(
                {"success": False, "error": "Username already taken."},
                status=status.HTTP_400_BAD_REQUEST,
            )
    else:
        generated_username = _build_generated_username(email, first_name, last_name, User)
        username = generated_username

    generated_password = ""
    if not password:
        generated_password = "123456"
        password = generated_password

    user = User.objects.create_user(
        username=username,
        email=email,
        first_name=first_name,
        last_name=last_name,
        password=password,
        is_staff=(requested_role == "ADMIN"),
        is_superuser=False,
    )
    profile = _get_profile(user)
    profile.must_change_password = True
    if phone_number:
        profile.phone_number = phone_number
    if nickname:
        profile.nickname = nickname
    profile.save(update_fields=["must_change_password", "phone_number", "nickname"])
    _write_action_log(
        request,
        "staff_created",
        (
            f"{_get_request_sender_label(request)} created {requested_role} account "
            f"for {first_name} {last_name}"
        ),
        metadata={
            "created_user_id": user.id,
            "username": username,
            "username_generated": bool(generated_username),
            "email": email,
            "role": requested_role,
        },
    )
    response_payload = {
        "success": True,
        "message": f"{requested_role} account created successfully.",
        "user": _build_user_payload(user),
    }
    if generated_password:
        response_payload["temporary_password"] = generated_password
        response_payload["message"] = (
            f"{requested_role} account created successfully. "
            f"Temporary password: {generated_password}"
        )
    if generated_username:
        response_payload["username_generated"] = True
        response_payload["message"] += " Username will be completed during onboarding."

    return Response(response_payload, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def auth_reset_password(request):
    email = (request.data.get("email") or "").strip()
    if not email:
        return Response(
            {"success": False, "error": "Email is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = _find_user_by_email_or_username(email)
    if not user or not (user.is_staff or user.is_superuser):
        return Response(
            {
                "success": True,
                "message": "If the account exists, a temporary password was sent to the registered email.",
            },
            status=status.HTTP_200_OK,
        )

    already_pending = PasswordResetRequest.objects.filter(
        user=user,
        status=PasswordResetRequest.STATUS_PENDING,
    ).exists()
    if not already_pending:
        PasswordResetRequest.objects.create(
            user=user,
            requested_email=user.email or email,
            status=PasswordResetRequest.STATUS_PENDING,
        )

    return Response(
        {
            "success": True,
            "message": (
                "Request submitted. A superuser must approve it before a temporary password is emailed."
                if not already_pending
                else "A password reset request is already pending superuser approval."
            ),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
def auth_logout(request):
    token_key = _extract_token(request)
    if token_key:
        Token.objects.filter(key=token_key).delete()
    return Response({"success": True}, status=status.HTTP_200_OK)


@api_view(["GET", "PUT"])
def auth_profile(request):
    token_key = _extract_token(request)
    if not token_key:
        return Response(
            {"success": False, "error": "Authorization token missing."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    token = Token.objects.select_related("user").filter(key=token_key).first()
    if not token:
        return Response(
            {"success": False, "error": "Invalid token."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user = token.user
    profile = _get_profile(user)

    if request.method == "GET":
        return Response(
            {
                "success": True,
                "user": _build_user_payload(user),
                "profile": {
                    "must_change_password": profile.must_change_password,
                    "profile_completed": profile.profile_completed,
                    "profile_photo_url": profile.profile_photo_url,
                    "phone_number": profile.phone_number,
                    "date_of_birth": (
                        profile.date_of_birth.isoformat()
                        if profile.date_of_birth
                        else None
                    ),
                    "nickname": profile.nickname,
                    "username_needs_setup": _is_placeholder_username(user.username),
                },
            },
            status=status.HTTP_200_OK,
        )

    first_name = (request.data.get("first_name") or "").strip()
    last_name = (request.data.get("last_name") or "").strip()
    username = (request.data.get("username") or "").strip()
    email = (request.data.get("email") or "").strip()
    profile_photo_url = (request.data.get("profile_photo_url") or "").strip()
    new_password = request.data.get("new_password") or ""
    phone_number = (request.data.get("phone_number") or "").strip()
    nickname = (request.data.get("nickname") or "").strip()
    date_of_birth = (request.data.get("date_of_birth") or "").strip()
    previous_nickname = (profile.nickname or "").strip()
    previous_username = (user.username or "").strip()
    previous_email = (user.email or "").strip()

    if email and email.lower() != (user.email or "").lower():
        User = get_user_model()
        if User.objects.exclude(id=user.id).filter(email__iexact=email).exists():
            return Response(
                {"success": False, "error": "Email already registered."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.email = email

    if username and username.lower() != (user.username or "").lower():
        User = get_user_model()
        if User.objects.exclude(id=user.id).filter(username__iexact=username).exists():
            return Response(
                {"success": False, "error": "Username already taken."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.username = username

    # Allow staff to edit first/last name ONLY during onboarding (must_change_password)
    if (first_name or last_name) and not _is_admin_or_owner_user(user):
        if not getattr(profile, "must_change_password", False):
            return Response(
                {"success": False, "error": "STAFF cannot edit first or last name."},
                status=status.HTTP_403_FORBIDDEN,
            )

    if first_name:
        user.first_name = first_name
    if last_name:
        user.last_name = last_name
    user_update_fields = []
    if first_name or last_name:
        user_update_fields.extend(["first_name", "last_name"])
    if email and email.lower() != previous_email.lower():
        user_update_fields.append("email")
    if username and username.lower() != previous_username.lower():
        user_update_fields.append("username")
    if user_update_fields:
        user.save(update_fields=user_update_fields)

    if profile_photo_url:
        profile.profile_photo_url = profile_photo_url
    if phone_number:
        profile.phone_number = phone_number
    if nickname:
        profile.nickname = nickname
    if date_of_birth:
        try:
            profile.date_of_birth = timezone.datetime.fromisoformat(
                date_of_birth
            ).date()
        except ValueError:
            return Response(
                {"success": False, "error": "Invalid date_of_birth format."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    if new_password:
        user.set_password(new_password)
        user.save(update_fields=["password"])
        profile.must_change_password = False

    if (
        not profile.must_change_password
        and profile.profile_photo_url
        and (user.first_name or user.last_name)
        and not _is_placeholder_username(user.username)
    ):
        profile.profile_completed = True

    sender_label = _get_request_sender_label(request)

    profile.save(update_fields=[
        "profile_photo_url",
        "phone_number",
        "date_of_birth",
        "nickname",
        "must_change_password",
        "profile_completed",
    ])

    if email and email.lower() != previous_email.lower():
        _write_action_log(
            request,
            "profile_email_changed",
            f"{sender_label} changed email from '{previous_email or '—'}' to '{user.email}'",
            metadata={
                "user_id": user.id,
                "old_email": previous_email,
                "new_email": user.email,
            },
        )

    if nickname and nickname != previous_nickname:
        _write_action_log(
            request,
            "profile_nickname_changed",
            f"{sender_label} changed nickname from '{previous_nickname or '—'}' to '{nickname}'",
            metadata={
                "user_id": user.id,
                "old_nickname": previous_nickname,
                "new_nickname": nickname,
            },
        )

    if new_password:
        _write_action_log(
            request,
            "profile_password_changed",
            f"{sender_label} changed account password",
            metadata={
                "user_id": user.id,
            },
        )

    if username and username.lower() != previous_username.lower():
        _write_action_log(
            request,
            "profile_username_changed",
            f"{sender_label} changed username from '{previous_username or '—'}' to '{user.username}'",
            metadata={
                "user_id": user.id,
                "old_username": previous_username,
                "new_username": user.username,
            },
        )

    return Response(
        {
            "success": True,
            "message": "Profile updated successfully.",
            "needs_profile_setup": bool(
                profile.must_change_password or not profile.profile_completed
            ),
        },
        status=status.HTTP_200_OK,
    )


def _staff_account_payload(user):
    profile = StaffProfile.objects.filter(user=user).first()
    if profile and profile.deleted_at is not None:
        return None
    return {
        "id": user.id,
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
        "username": user.username or "",
        "email": user.email or "",
        "role": _role_name_for_user(user),
        "is_active": bool(user.is_active),
        "profile": {
            "phone_number": (profile.phone_number or "") if profile else "",
            "nickname": (profile.nickname or "") if profile else "",
            "profile_photo_url": (profile.profile_photo_url or "") if profile else "",
            "must_change_password": bool(profile.must_change_password) if profile else True,
            "profile_completed": bool(profile.profile_completed) if profile else False,
        },
    }


@api_view(["GET"])
def auth_staff_accounts(request):
    request_user = _get_request_user(request)
    if not _is_admin_or_owner_user(request_user):
        return Response(
            {"success": False, "error": "Only admin/owner can manage staff accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )

    User = get_user_model()
    if _is_owner_or_dev_user(request_user):
        qs = (
            User.objects.filter(
                Q(is_staff=True) | Q(is_superuser=True) | Q(staff_profile__isnull=False)
            )
            .exclude(staff_profile__deleted_at__isnull=False)
            .distinct()
            .order_by("is_superuser", "is_staff", "first_name", "last_name", "username")
        )
    else:
        # ADMIN can manage STAFF accounts only.
        qs = User.objects.filter(is_superuser=False, is_staff=False).exclude(
            staff_profile__deleted_at__isnull=False
        ).order_by(
            "first_name", "last_name", "username"
        )
    accounts = [payload for payload in (_staff_account_payload(u) for u in qs) if payload]
    return Response(
        {
            "success": True,
            "accounts": accounts,
        },
        status=status.HTTP_200_OK,
    )


@api_view(["PUT", "DELETE"])
def auth_staff_account_detail(request, user_id):
    request_user = _get_request_user(request)
    if not _is_admin_or_owner_user(request_user):
        return Response(
            {"success": False, "error": "Only admin/owner can manage staff accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )

    User = get_user_model()
    target = User.objects.filter(id=user_id).first()
    if not target:
        return Response(
            {"success": False, "error": "Account not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    if request.method == "DELETE":
        if not _is_owner_or_dev_user(request_user):
            return Response(
                {"success": False, "error": "Only owner/dev can delete accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if target.id == request_user.id:
            return Response(
                {"success": False, "error": "You cannot delete your own account."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target_is_managed = bool(
            getattr(target, "is_superuser", False)
            or getattr(target, "is_staff", False)
            or StaffProfile.objects.filter(user=target).exists()
        )
        if not target_is_managed:
            return Response(
                {
                    "success": False,
                    "error": "Only STAFF, ADMIN, or OWNER accounts can be deleted.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        deleted_role = _role_name_for_user(target)
        deleted_user_id = target.id
        deleted_username = target.username or ""
        deleted_email = target.email or ""
        profile = _get_profile(target)
        if profile.deleted_at is not None:
            return Response(
                {"success": False, "error": "Account is already in Internal Records."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        profile.deleted_at = timezone.now()
        profile.save(update_fields=["deleted_at"])
        target.is_active = False
        target.save(update_fields=["is_active"])

        _write_action_log(
            request,
            "account_recycled",
            f"{_get_request_sender_label(request)} moved {deleted_role} account {deleted_username or ('#' + str(deleted_user_id))} to Internal Records",
            metadata={
                "deleted_user_id": deleted_user_id,
                "deleted_username": deleted_username,
                "deleted_email": deleted_email,
                "deleted_role": deleted_role,
            },
        )

        return Response(
            {
                "success": True,
                "message": "Account moved to Internal Records.",
            },
            status=status.HTTP_200_OK,
        )

    first_name = (request.data.get("first_name") or "").strip()
    last_name = (request.data.get("last_name") or "").strip()
    username = (request.data.get("username") or "").strip()
    email = (request.data.get("email") or "").strip()
    role = (request.data.get("role") or "STAFF").strip().upper()
    phone_number = (request.data.get("phone_number") or "").strip()
    nickname = (request.data.get("nickname") or "").strip()
    profile_photo_url = (request.data.get("profile_photo_url") or "").strip()
    new_password = request.data.get("new_password") or ""
    set_active = request.data.get("is_active")
    force_password_change = request.data.get("must_change_password")

    if not first_name or not last_name or not username or not email:
        return Response(
            {
                "success": False,
                "error": "First name, last name, username, and email are required.",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if role not in {"STAFF", "ADMIN", "OWNER"}:
        return Response(
            {"success": False, "error": "Role must be STAFF, ADMIN, or OWNER."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    is_owner_request = _is_owner_or_dev_user(request_user)
    if not is_owner_request:
        # ADMIN restrictions: only edit STAFF, cannot promote/demote roles.
        if getattr(target, "is_staff", False) or getattr(target, "is_superuser", False):
            return Response(
                {"success": False, "error": "ADMIN can only edit STAFF accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )
        role = "STAFF"

    if (
        User.objects.exclude(id=target.id)
        .filter(username__iexact=username)
        .exists()
    ):
        return Response(
            {"success": False, "error": "Username already taken."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if User.objects.exclude(id=target.id).filter(email__iexact=email).exists():
        return Response(
            {"success": False, "error": "Email already registered."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if target.id == request_user.id and role != "OWNER":
        return Response(
            {"success": False, "error": "You cannot remove your own OWNER role."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if target.id == request_user.id and set_active is False:
        return Response(
            {"success": False, "error": "You cannot deactivate your own account."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    previous_role = _role_name_for_user(target)

    target.first_name = first_name
    target.last_name = last_name
    target.username = username
    target.email = email
    target.is_superuser = role == "OWNER"
    target.is_staff = role in {"ADMIN", "OWNER"}
    if isinstance(set_active, bool):
        target.is_active = set_active

    update_fields = [
        "first_name",
        "last_name",
        "username",
        "email",
        "is_superuser",
        "is_staff",
        "is_active",
    ]
    if new_password:
        target.set_password(new_password)
        update_fields.append("password")
    target.save(update_fields=update_fields)

    profile = _get_profile(target)
    profile.phone_number = phone_number
    profile.nickname = nickname
    profile.profile_photo_url = profile_photo_url
    if isinstance(force_password_change, bool):
        profile.must_change_password = force_password_change
    profile.profile_completed = bool(profile.profile_photo_url and (target.first_name or target.last_name))
    profile.save(
        update_fields=[
            "phone_number",
            "nickname",
            "profile_photo_url",
            "must_change_password",
            "profile_completed",
        ]
    )

    updated_role = _role_name_for_user(target)
    role_action_type = {
        "STAFF": "staff_account_updated",
        "ADMIN": "admin_account_updated",
        "OWNER": "owner_account_updated",
    }.get(updated_role, "staff_account_updated")
    _write_action_log(
        request,
        role_action_type,
        f"{_get_request_sender_label(request)} updated account for {target.username}",
        metadata={
            "updated_user_id": target.id,
            "updated_username": target.username,
            "updated_email": target.email,
            "previous_role": previous_role,
            "updated_role": updated_role,
            "is_active": target.is_active,
            "password_changed": bool(new_password),
        },
    )

    return Response(
        {
            "success": True,
            "message": "Account updated successfully.",
            "account": _staff_account_payload(target),
        },
        status=status.HTTP_200_OK,
    )


def _deleted_account_payload(profile):
    user = profile.user
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    role = _role_name_for_user(user)
    return {
        "id": user.id,
        "username": user.username or "",
        "email": user.email or "",
        "name": name,
        "role": role,
        "deleted_at": profile.deleted_at.isoformat() if profile.deleted_at else None,
    }


@api_view(["POST"])
def auth_staff_account_restore(request, user_id):
    request_user = _get_request_user(request)
    if not _is_admin_or_owner_user(request_user):
        return Response(
            {"success": False, "error": "Only admin/owner can manage staff accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )

    User = get_user_model()
    target = User.objects.filter(id=user_id).first()
    if not target:
        return Response(
            {"success": False, "error": "Account not found."},
            status=status.HTTP_404_NOT_FOUND,
        )
    if target.id == request_user.id:
        return Response(
            {"success": False, "error": "You cannot restore your own account from Internal Records."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if (not _is_owner_or_dev_user(request_user)) and (
        getattr(target, "is_staff", False) or getattr(target, "is_superuser", False)
    ):
        return Response(
            {"success": False, "error": "ADMIN can only restore STAFF accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )
    profile = StaffProfile.objects.filter(user=target).first()
    if not profile or profile.deleted_at is None:
        return Response(
            {"success": False, "error": "This account is not in Internal Records."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    profile.deleted_at = None
    profile.save(update_fields=["deleted_at"])
    target.is_active = True
    target.save(update_fields=["is_active"])
    _write_action_log(
        request,
        "account_restored",
        f"{_get_request_sender_label(request)} restored {_role_name_for_user(target)} account {target.username or ('#' + str(target.id))} from Internal Records",
        metadata={
            "restored_user_id": target.id,
            "restored_username": target.username or "",
            "restored_email": target.email or "",
            "restored_role": _role_name_for_user(target),
        },
    )
    return Response(
        {
            "success": True,
            "message": "Account restored from Internal Records.",
            "account": _staff_account_payload(target),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
def auth_staff_account_purge(request, user_id):
    request_user = _get_request_user(request)
    if not _is_admin_or_owner_user(request_user):
        return Response(
            {"success": False, "error": "Only admin/owner can manage staff accounts."},
            status=status.HTTP_403_FORBIDDEN,
        )
    if not _can_purge_internal_records(request_user):
        return Response(
            {"success": False, "error": "Permanent delete requires Dev mode."},
            status=status.HTTP_403_FORBIDDEN,
        )
    User = get_user_model()
    target = User.objects.filter(id=user_id).first()
    if not target:
        return Response(
            {"success": False, "error": "Account not found."},
            status=status.HTTP_404_NOT_FOUND,
        )
    if target.id == request_user.id:
        return Response(
            {"success": False, "error": "You cannot permanently delete your own account."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    profile = StaffProfile.objects.filter(user=target).first()
    if not profile or profile.deleted_at is None:
        return Response(
            {"success": False, "error": "Permanent delete is only available for accounts in Internal Records."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    purged_role = _role_name_for_user(target)
    purged_user_id = target.id
    purged_username = target.username or ""
    purged_email = target.email or ""
    target.delete()
    _write_action_log(
        request,
        "account_purged",
        f"{_get_request_sender_label(request)} permanently deleted {purged_role} account {purged_username or ('#' + str(purged_user_id))}",
        metadata={
            "purged_user_id": purged_user_id,
            "purged_username": purged_username,
            "purged_email": purged_email,
            "purged_role": purged_role,
        },
    )
    return Response(status=status.HTTP_204_NO_CONTENT)
