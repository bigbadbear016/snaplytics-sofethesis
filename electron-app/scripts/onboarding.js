// scripts/onboarding.js

(function initOnboarding() {
    const steps = Array.from(document.querySelectorAll("[data-step]"));
    const prevBtn = document.getElementById("prev-btn");
    const nextBtn = document.getElementById("next-btn");
    const errorEl = document.getElementById("step-error");
    const emailEl = document.getElementById("setup-user-email");
    const photoFile = document.getElementById("photo-file");
    const photoUrl = document.getElementById("photo-url");
    const photoPreview = document.getElementById("photo-preview");

    let currentStep = 0;
    let passwordOnlyFlow = false;
    let currentProfile = null;
    let photoDataUrl = "";
    const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

    const user = JSON.parse(sessionStorage.getItem("user") || "{}");
    if (emailEl) emailEl.textContent = user.email || "New staff account";

    const firstNameEl = document.getElementById("first-name");
    const lastNameEl = document.getElementById("last-name");
    const nicknameEl = document.getElementById("nickname");
    const phoneEl = document.getElementById("phone-number");
    const dobEl = document.getElementById("date-of-birth");
    if (firstNameEl && user.name) {
        const parts = user.name.split(" ");
        firstNameEl.value = parts[0] || "";
        lastNameEl.value = parts.slice(1).join(" ");
    }

    function setError(message) {
        if (!errorEl) return;
        if (!message) {
            errorEl.classList.add("hidden");
            errorEl.textContent = "";
            return;
        }
        errorEl.textContent = message;
        errorEl.classList.remove("hidden");
    }

    function updateStepDots() {
        for (let i = 1; i <= 3; i += 1) {
            const dot = document.getElementById(`step-dot-${i}`);
            if (!dot) continue;
            if (i - 1 === currentStep) {
                dot.classList.remove("bg-gray-300");
                dot.classList.add("bg-[#165166]");
            } else {
                dot.classList.remove("bg-[#165166]");
                dot.classList.add("bg-gray-300");
            }
        }
    }

    function showStep(index) {
        currentStep = index;
        steps.forEach((panel, i) => {
            if (i === index) {
                panel.classList.remove("hidden");
            } else {
                panel.classList.add("hidden");
            }
        });

        prevBtn.disabled = index === 0;
        prevBtn.classList.toggle("opacity-50", index === 0);
        prevBtn.classList.toggle("cursor-not-allowed", index === 0);

        const isLastStep = passwordOnlyFlow
            ? index === 0
            : index === steps.length - 1;
        nextBtn.textContent = isLastStep ? "Finish" : "Next";
        setError("");
        updateStepDots();
    }

    function setPasswordOnlyUI() {
        passwordOnlyFlow = true;
        const subtitle = document.querySelector("h1 + p");
        if (subtitle) {
            subtitle.textContent =
                "Your profile is already complete. Update your password to continue.";
        }

        const step2 = document.querySelector('[data-step="2"]');
        const step3 = document.querySelector('[data-step="3"]');
        if (step2) step2.classList.add("hidden");
        if (step3) step3.classList.add("hidden");

        const dot2 = document.getElementById("step-dot-2")?.parentElement;
        const dot3 = document.getElementById("step-dot-3")?.parentElement;
        const separators = Array.from(
            document.querySelectorAll(".h-\\[1px\\].flex-1.bg-gray-200"),
        );
        if (dot2) dot2.classList.add("hidden");
        if (dot3) dot3.classList.add("hidden");
        separators.forEach((el) => el.classList.add("hidden"));
    }

    function getInitials() {
        const first = (firstNameEl?.value || "N").trim()[0] || "N";
        const last = (lastNameEl?.value || "E").trim()[0] || "E";
        return `${first}${last}`.toUpperCase();
    }

    function updatePhotoPreviewFromUrl(url) {
        if (!photoPreview) return;
        if (!url) {
            photoPreview.style.backgroundImage = "";
            photoPreview.textContent = getInitials();
            return;
        }
        photoPreview.textContent = "";
        photoPreview.style.backgroundImage = `url('${url}')`;
        photoPreview.style.backgroundSize = "cover";
        photoPreview.style.backgroundPosition = "center";
    }

    if (photoFile) {
        photoFile.addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (file.size > MAX_PHOTO_BYTES) {
                setError("Photo must be 2MB or smaller.");
                photoFile.value = "";
                photoDataUrl = "";
                updatePhotoPreviewFromUrl("");
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                photoDataUrl = reader.result || "";
                updatePhotoPreviewFromUrl(photoDataUrl);
            };
            reader.readAsDataURL(file);
        });
    }

    if (photoUrl) {
        photoUrl.addEventListener("input", (e) => {
            const value = e.target.value.trim();
            if (value) {
                updatePhotoPreviewFromUrl(value);
            } else if (!photoDataUrl) {
                updatePhotoPreviewFromUrl("");
            }
        });
    }

    if (firstNameEl || lastNameEl) {
        const updateInitials = () => {
            if (!photoUrl?.value && !photoDataUrl) {
                updatePhotoPreviewFromUrl("");
            }
        };
        firstNameEl?.addEventListener("input", updateInitials);
        lastNameEl?.addEventListener("input", updateInitials);
        updateInitials();
    }

    prevBtn.addEventListener("click", () => {
        if (passwordOnlyFlow) return;
        if (currentStep > 0) {
            showStep(currentStep - 1);
        }
    });

    async function submitPasswordOnly() {
        const pw = document.getElementById("new-password").value.trim();
        const confirm = document.getElementById("confirm-password").value.trim();
        if (!pw || !confirm) {
            setError("Please enter and confirm your new password.");
            return;
        }
        if (pw.length < 6) {
            setError("Password must be at least 6 characters.");
            return;
        }
        if (pw !== confirm) {
            setError("Passwords do not match.");
            return;
        }

        nextBtn.disabled = true;
        nextBtn.classList.add("opacity-70");
        setError("");

        const result = await API.updateProfile({ new_password: pw });
        if (!result || !result.success) {
            setError((result && result.error) || "Failed to update password.");
            nextBtn.disabled = false;
            nextBtn.classList.remove("opacity-70");
            return;
        }

        sessionStorage.setItem("needsProfileSetup", "false");
        window.location.href = "./shell.html";
    }

    nextBtn.addEventListener("click", async () => {
        if (passwordOnlyFlow) {
            await submitPasswordOnly();
            return;
        }

        if (currentStep === 0) {
            const pw = document.getElementById("new-password").value.trim();
            const confirm = document
                .getElementById("confirm-password")
                .value.trim();
            if (!pw || !confirm) {
                setError("Please enter and confirm your new password.");
                return;
            }
            if (pw.length < 6) {
                setError("Password must be at least 6 characters.");
                return;
            }
            if (pw !== confirm) {
                setError("Passwords do not match.");
                return;
            }
            showStep(1);
            return;
        }

        if (currentStep === 1) {
            const urlValue = photoUrl ? photoUrl.value.trim() : "";
            const finalPhoto = urlValue || photoDataUrl;
            if (!finalPhoto) {
                setError("Please upload a photo or paste an image URL.");
                return;
            }
            showStep(2);
            return;
        }

        if (currentStep === 2) {
            const firstName = firstNameEl.value.trim();
            const lastName = lastNameEl.value.trim();
            const nickname = nicknameEl ? nicknameEl.value.trim() : "";
            const phoneNumber = phoneEl ? phoneEl.value.trim() : "";
            const dateOfBirth = dobEl ? dobEl.value.trim() : "";
            if (!firstName || !lastName) {
                setError("Please enter your first and last name.");
                return;
            }
            if (!nickname || !phoneNumber || !dateOfBirth) {
                setError("Please complete nickname, phone, and date of birth.");
                return;
            }

            const urlValue = photoUrl ? photoUrl.value.trim() : "";
            const finalPhoto = urlValue || photoDataUrl;
            const newPassword = document
                .getElementById("new-password")
                .value.trim();

            nextBtn.disabled = true;
            nextBtn.classList.add("opacity-70");
            setError("");

            const result = await API.updateProfile({
                first_name: firstName,
                last_name: lastName,
                nickname: nickname,
                phone_number: phoneNumber,
                date_of_birth: dateOfBirth,
                profile_photo_url: finalPhoto,
                new_password: newPassword,
            });

            if (!result || !result.success) {
                setError(
                    (result && result.error) ||
                        "Setup failed. Please try again.",
                );
                nextBtn.disabled = false;
                nextBtn.classList.remove("opacity-70");
                return;
            }

            if (result.needs_profile_setup) {
                setError("Please complete all required steps.");
                nextBtn.disabled = false;
                nextBtn.classList.remove("opacity-70");
                return;
            }

            sessionStorage.setItem("needsProfileSetup", "false");
            const updatedUser = { ...(user || {}) };
            updatedUser.name = `${firstName} ${lastName}`.trim();
            sessionStorage.setItem("user", JSON.stringify(updatedUser));

            window.location.href = "./shell.html";
        }
    });

    (async () => {
        try {
            const profileRes = await API.getProfile();
            if (profileRes && profileRes.success) {
                currentProfile = profileRes.profile || {};
                const profileUser = profileRes.user || {};
                if (emailEl && profileUser.email) {
                    emailEl.textContent = profileUser.email;
                }

                if (firstNameEl && !firstNameEl.value) {
                    const derivedFirst =
                        profileUser.first_name ||
                        (profileUser.name || "").split(" ")[0] ||
                        "";
                    firstNameEl.value = derivedFirst;
                }
                if (lastNameEl && !lastNameEl.value) {
                    const nameParts = (profileUser.name || "")
                        .split(" ")
                        .filter(Boolean);
                    const derivedLast =
                        profileUser.last_name ||
                        nameParts.slice(1).join(" ") ||
                        "";
                    lastNameEl.value = derivedLast;
                }
                if (nicknameEl && currentProfile.nickname) {
                    nicknameEl.value = currentProfile.nickname;
                }
                if (phoneEl && currentProfile.phone_number) {
                    phoneEl.value = currentProfile.phone_number;
                }
                if (dobEl && currentProfile.date_of_birth) {
                    dobEl.value = currentProfile.date_of_birth;
                }
                if (photoUrl && currentProfile.profile_photo_url) {
                    photoUrl.value = currentProfile.profile_photo_url;
                    updatePhotoPreviewFromUrl(currentProfile.profile_photo_url);
                }

                if (
                    currentProfile.profile_completed &&
                    currentProfile.must_change_password
                ) {
                    setPasswordOnlyUI();
                }
            }
        } catch (_) {
            // Keep default multi-step flow on profile fetch failure.
        }

        showStep(0);
    })();
})();
