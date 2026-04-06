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

    const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
    let photoDataUrl = "";

    function setPhotoStatus(message) {
        if (!photoStatus) return;
        photoStatus.textContent = message || "";
    }

    function buildFallbackAvatar(fullName) {
        const initials = (fullName || "NE")
            .split(" ")
            .filter(Boolean)
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase();
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

    function applyNameEditRoleGuard(role) {
        const isStaff = role === "STAFF";
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
        if (roleEl) roleEl.textContent = role;
        if (roleTextEl) roleTextEl.textContent = role;
        applyNameEditRoleGuard(role);
        if (emailEl) emailEl.textContent = email;
        if (usernameEl) usernameEl.value = username;

        const nameParts = fullName.split(" ").filter(Boolean);
        if (firstNameEl && !firstNameEl.value) {
            firstNameEl.value = nameParts[0] || "";
        }
        if (lastNameEl && !lastNameEl.value) {
            lastNameEl.value = nameParts.slice(1).join(" ");
        }

        if (photoImg) {
            photoImg.src = photo || buildFallbackAvatar(fullName);
        }
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

    async function saveProfilePatch(payload, failMessage) {
        const result = await API.updateProfile(payload);
        if (!result || !result.success) {
            window.heigenAlert((result && result.error) || failMessage);
            return false;
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
            );
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        refreshProfile();
    });
})();
