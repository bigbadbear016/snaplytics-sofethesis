// scripts/profile-page.js

(function profilePage() {
    if (typeof API === "undefined") return;

    const photoFile = document.getElementById("profile-photo-file");
    const photoUrl = document.getElementById("profile-photo-url");
    const photoImg = document.getElementById("profile-photo");
    const nameEl = document.getElementById("profile-name");
    const roleEl = document.getElementById("profile-role");
    const roleTextEl = document.getElementById("profile-role-text");
    const emailEl = document.getElementById("profile-email");
    const saveEmailBtn = document.getElementById("save-email-btn");
    const usernameEl = document.getElementById("profile-username");
    const saveUsernameBtn = document.getElementById("save-username-btn");
    const firstNameEl = document.getElementById("profile-first-name");
    const lastNameEl = document.getElementById("profile-last-name");
    const saveNameBtn = document.getElementById("save-name-btn");
    const savePhotoBtn = document.getElementById("save-photo-btn");
    const photoStatus = document.getElementById("photo-status");
    const savePasswordBtn = document.getElementById("save-password-btn");
    const newPasswordEl = document.getElementById("profile-new-password");
    const confirmPasswordEl = document.getElementById("profile-confirm-password");
    const phoneEl = document.getElementById("profile-phone-number");
    const dobEl = document.getElementById("profile-date-of-birth");
    const nicknameEl = document.getElementById("profile-nickname");
    const savePhoneBtn = document.getElementById("save-phone-btn");
    const saveDobBtn = document.getElementById("save-dob-btn");
    const saveNicknameBtn = document.getElementById("save-nickname-btn");
    const emailTextEl = document.getElementById("profile-email-text");
    const usernameTextEl = document.getElementById("profile-username-text");
    const nameLockEl = document.getElementById("pf-name-lock");
    const emailLockEl = document.getElementById("pf-email-lock");
    const accessNoteEl = document.getElementById("pf-access-note");

    const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
    let photoDataUrl = "";

    function setPhotoStatus(message) {
        if (!photoStatus) return;
        photoStatus.textContent = message || "";
    }

    function buildFallbackAvatar(fullName) {
        // First + last initial — matches the header avatar (staff-profile.js)
        const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
        const initials = parts.length
            ? `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase()
            : "NE";
        const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <rect width="100%" height="100%" fill="#E8F0F2"/>
  <text x="50%" y="54%" font-size="72" text-anchor="middle" fill="#165166" font-family="Segoe UI, sans-serif" dy=".1em">${initials}</text>
</svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    function resolveRole(user) {
        if (!user || typeof user !== "object") return "STAFF";
        let r = user.role;
        if (!r) {
            try {
                const cached = JSON.parse(sessionStorage.getItem("user") || "{}");
                if (cached && cached.role) r = cached.role;
            } catch (_) {}
        }
        if (r) return String(r).toUpperCase();
        if (user.is_superuser) return "OWNER";
        if (user.is_staff) return "ADMIN";
        return "STAFF";
    }

    function getSessionUser() {
        if (
            window.staffAuth &&
            typeof window.staffAuth.getSessionUser === "function"
        ) {
            return window.staffAuth.getSessionUser();
        }
        try {
            return JSON.parse(sessionStorage.getItem("user") || "{}");
        } catch (_) {
            return {};
        }
    }

    // "OWNER" → "Owner"; unknown roles still render cleanly
    function roleLabel(role) {
        const r = String(role || "STAFF").toLowerCase();
        return r.charAt(0).toUpperCase() + r.slice(1);
    }

    function setRoleBadge(el, role) {
        if (!el) return;
        el.textContent = roleLabel(role);
        el.setAttribute("data-role", String(role || "STAFF").toLowerCase());
    }

    // Broken/missing photo URLs fall back to the initials avatar
    function setAvatar(img, src, fullName) {
        if (!img) return;
        const fallback = buildFallbackAvatar(fullName);
        img.onerror = () => {
            img.onerror = null;
            img.src = fallback;
        };
        img.src = src || fallback;
    }

    function applyNameEditRoleGuard(role) {
        const isStaff = role === "STAFF";
        if (nameLockEl) nameLockEl.hidden = !isStaff;
        if (emailLockEl) emailLockEl.hidden = !isStaff;
        [firstNameEl, lastNameEl, emailEl].forEach((el) => {
            if (el) el.classList.toggle("pf-readonly", isStaff);
        });
        if (accessNoteEl) {
            accessNoteEl.hidden = !isStaff;
            accessNoteEl.textContent = isStaff
                ? "Your name and email are managed by an Admin or Owner. Ask them if these need to change."
                : "";
        }
        if (firstNameEl) firstNameEl.readOnly = isStaff;
        if (lastNameEl) lastNameEl.readOnly = isStaff;
        if (saveNameBtn) {
            if (isStaff) {
                saveNameBtn.style.display = "none";
            } else {
                saveNameBtn.style.display = "";
            }
        }
    }

    function applyEmailEditRoleGuard(role) {
        const isStaff = role === "STAFF";
        if (emailEl) emailEl.readOnly = isStaff;
        if (saveEmailBtn) {
            if (isStaff) {
                saveEmailBtn.style.display = "none";
            } else {
                saveEmailBtn.style.display = "";
            }
        }
    }

    function applyProfile(user, profile) {
        const fullName =
            user?.name ||
            `${user?.first_name || ""} ${user?.last_name || ""}`.trim() ||
            user?.email ||
            "New User";
        const role = resolveRole(user);
        const email = user?.email || "";
        const username = user?.username || "";
        const photo = profile?.profile_photo_url || "";

        if (nameEl) nameEl.textContent = fullName;
        setRoleBadge(roleEl, role);
        setRoleBadge(roleTextEl, role);
        if (emailTextEl) {
            emailTextEl.textContent = email || "No email on file";
            emailTextEl.title = email;
        }
        if (usernameTextEl) usernameTextEl.textContent = username ? `@${username}` : "—";
        applyNameEditRoleGuard(role);
        applyEmailEditRoleGuard(role);
        if (emailEl) emailEl.value = email;
        if (usernameEl) usernameEl.value = username;

        const nameParts = fullName.split(" ").filter(Boolean);
        if (firstNameEl && !firstNameEl.value) {
            firstNameEl.value = nameParts[0] || "";
        }
        if (lastNameEl && !lastNameEl.value) {
            lastNameEl.value = nameParts.slice(1).join(" ");
        }

        setAvatar(photoImg, photo, fullName);
        if (phoneEl && profile?.phone_number) {
            phoneEl.value = profile.phone_number;
        }
        if (dobEl && profile?.date_of_birth) {
            dobEl.value = profile.date_of_birth;
        }
        if (nicknameEl && profile?.nickname) {
            nicknameEl.value = profile.nickname;
        }
    }

    async function refreshProfile() {
        if (typeof MOCK_MODE !== "undefined" && MOCK_MODE) {
            const user = JSON.parse(sessionStorage.getItem("user") || "{}");
            applyProfile(user, { profile_photo_url: null });
            return;
        }

        const result = await API.getProfile();
        if (!result || !result.success) return;
        sessionStorage.setItem("user", JSON.stringify(result.user || {}));
        applyProfile(result.user || {}, result.profile || {});
    }

    async function saveProfilePatch(payload, failMessage, successMessage) {
        const result = await API.updateProfile(payload);
        if (!result || !result.success) {
            window.heigenAlert((result && result.error) || failMessage);
            return false;
        }
        if (successMessage) {
            window.heigenAlert(successMessage);
        }
        await refreshProfile();
        return true;
    }

    if (photoFile) {
        photoFile.addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (file.size > MAX_PHOTO_BYTES) {
                setPhotoStatus("Photo must be 2MB or smaller.");
                photoFile.value = "";
                photoDataUrl = "";
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                photoDataUrl = reader.result || "";
                if (photoImg) {
                    photoImg.src = photoDataUrl;
                }
                setPhotoStatus(
                    `Photo ready (${file.name}). Click Save Photo.`,
                );
            };
            reader.readAsDataURL(file);
        });
    }

    if (savePhotoBtn) {
        savePhotoBtn.addEventListener("click", async () => {
            const urlValue = photoUrl ? photoUrl.value.trim() : "";
            const finalPhoto = urlValue || photoDataUrl;
            if (!finalPhoto) {
                setPhotoStatus("Please upload a photo or paste a URL.");
                return;
            }
            setPhotoStatus("Saving...");
            const result = await API.updateProfile({
                profile_photo_url: finalPhoto,
            });
            if (!result || !result.success) {
                setPhotoStatus(
                    (result && result.error) || "Failed to save photo.",
                );
                return;
            }
            sessionStorage.setItem("profilePhotoUrl", finalPhoto);
            setPhotoStatus("Photo saved.");
            window.heigenAlert("Profile photo updated successfully.");
            await refreshProfile();
        });
    }

    if (saveNameBtn) {
        saveNameBtn.addEventListener("click", async () => {
            const currentRole = resolveRole(getSessionUser());
            if (currentRole === "STAFF") {
                window.heigenAlert("Only ADMIN or OWNER can edit first and last name.");
                return;
            }
            const firstName = firstNameEl.value.trim();
            const lastName = lastNameEl.value.trim();
            if (!firstName || !lastName) {
                window.heigenAlert("Please enter both first and last name.");
                return;
            }
            const result = await API.updateProfile({
                first_name: firstName,
                last_name: lastName,
            });
            if (!result || !result.success) {
                window.heigenAlert((result && result.error) || "Failed to save name.");
                return;
            }
            const user = JSON.parse(sessionStorage.getItem("user") || "{}");
            user.name = `${firstName} ${lastName}`.trim();
            sessionStorage.setItem("user", JSON.stringify(user));
            window.heigenAlert("Name updated successfully.");
            await refreshProfile();
        });
    }

    if (saveEmailBtn) {
        saveEmailBtn.addEventListener("click", async () => {
            const currentRole = resolveRole(getSessionUser());
            if (currentRole === "STAFF") {
                window.heigenAlert("Only ADMIN or OWNER can change email.");
                return;
            }
            const email = (emailEl?.value || "").trim();
            if (!email) {
                window.heigenAlert("Please enter an email address.");
                return;
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                window.heigenAlert("Please enter a valid email address.");
                return;
            }
            const result = await API.updateProfile({
                email,
            });
            if (!result || !result.success) {
                window.heigenAlert((result && result.error) || "Failed to save email.");
                return;
            }
            const user = JSON.parse(sessionStorage.getItem("user") || "{}");
            user.email = email;
            sessionStorage.setItem("user", JSON.stringify(user));
            window.heigenAlert("Email updated successfully.");
            await refreshProfile();
        });
    }

    if (saveUsernameBtn) {
        saveUsernameBtn.addEventListener("click", async () => {
            const username = (usernameEl?.value || "").trim();
            if (!username) {
                window.heigenAlert("Please enter a username.");
                return;
            }
            const result = await API.updateProfile({
                username,
            });
            if (!result || !result.success) {
                window.heigenAlert((result && result.error) || "Failed to save username.");
                return;
            }
            const user = JSON.parse(sessionStorage.getItem("user") || "{}");
            user.username = username;
            sessionStorage.setItem("user", JSON.stringify(user));
            window.heigenAlert("Username updated successfully.");
            await refreshProfile();
        });
    }

    if (savePasswordBtn) {
        savePasswordBtn.addEventListener("click", async () => {
            const pw = newPasswordEl.value.trim();
            const confirm = confirmPasswordEl.value.trim();
            if (!pw || !confirm) {
                window.heigenAlert("Please enter and confirm your new password.");
                return;
            }
            if (pw.length < 6) {
                window.heigenAlert("Password must be at least 6 characters.");
                return;
            }
            if (pw !== confirm) {
                window.heigenAlert("Passwords do not match.");
                return;
            }
            const result = await API.updateProfile({
                new_password: pw,
            });
            if (!result || !result.success) {
                window.heigenAlert((result && result.error) || "Failed to change password.");
                return;
            }
            newPasswordEl.value = "";
            confirmPasswordEl.value = "";
            updatePasswordChecks();
            window.heigenAlert("Password updated.");
        });
    }

    if (savePhoneBtn) {
        savePhoneBtn.addEventListener("click", async () => {
            const phoneNumber = phoneEl.value.trim();
            if (!phoneNumber) {
                window.heigenAlert("Please enter your phone number.");
                return;
            }
            await saveProfilePatch(
                {
                    phone_number: phoneNumber,
                },
                "Failed to save phone.",
                "Phone number updated successfully.",
            );
        });
    }

    if (saveDobBtn) {
        saveDobBtn.addEventListener("click", async () => {
            const dateOfBirth = dobEl.value.trim();
            if (!dateOfBirth) {
                window.heigenAlert("Please select your date of birth.");
                return;
            }
            await saveProfilePatch(
                {
                    date_of_birth: dateOfBirth,
                },
                "Failed to save DOB.",
                "Date of birth updated successfully.",
            );
        });
    }

    if (saveNicknameBtn) {
        saveNicknameBtn.addEventListener("click", async () => {
            const nickname = nicknameEl.value.trim();
            if (!nickname) {
                window.heigenAlert("Please enter your nickname.");
                return;
            }
            await saveProfilePatch(
                {
                    nickname: nickname,
                },
                "Failed to save nickname.",
                "Nickname updated successfully.",
            );
        });
    }

    document.querySelectorAll("[data-pw-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const input = document.getElementById(btn.getAttribute("data-pw-toggle"));
            if (!input) return;
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            btn.setAttribute("aria-pressed", show ? "true" : "false");
            btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
        });
    });

    function updatePasswordChecks() {
        const pw = newPasswordEl ? newPasswordEl.value : "";
        const confirm = confirmPasswordEl ? confirmPasswordEl.value : "";
        const lengthEl = document.getElementById("pf-check-length");
        const matchEl = document.getElementById("pf-check-match");
        if (lengthEl) lengthEl.classList.toggle("is-ok", pw.trim().length >= 6);
        if (matchEl) matchEl.classList.toggle("is-ok", !!pw && pw === confirm);
    }
    [newPasswordEl, confirmPasswordEl].forEach((el) => {
        if (el) el.addEventListener("input", updatePasswordChecks);
    });

    document.addEventListener("DOMContentLoaded", () => {
        refreshProfile();
    });
})();
