"""Who may call which API action.

Signed-in staff (STAFF, ADMIN, OWNER) may call every action; views still apply
their own role checks on top (for example ADMIN/OWNER-only restore).

Without a login, only the actions the customer kiosk needs are open. The kiosk
runs on public links (ngrok / Cloudflare), so everything else must require a
staff login.
"""

from rest_framework.permissions import BasePermission


class StaffOrKioskAction(BasePermission):
    """Allow anonymous requests only for the view's ``kiosk_actions``.

    Set ``kiosk_actions`` on a viewset to the action names the kiosk calls,
    for example ``("list", "retrieve")``. Every other action needs a login.
    """

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            return True
        return getattr(view, "action", None) in getattr(view, "kiosk_actions", ())
