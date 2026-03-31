// scripts/heigen-app.js
// ==============================================
// HEIGEN ADMIN SYSTEM - MAIN APPLICATION
// ==============================================

// Global State Management
const AppState = {
    currentUser: null,
    currentScreen: null,
    customers: [],
    packages: [],
    addons: [],
    selectedCustomer: null,
};

function getOnboardingFlag() {
    return sessionStorage.getItem("needsProfileSetup") === "true";
}

function setOnboardingFlag(value) {
    sessionStorage.setItem("needsProfileSetup", value ? "true" : "false");
}

function isStaffAdminPage() {
    const path = window.location.pathname.toLowerCase();
    return path.includes("/staff_admin/");
}

function isOnboardingPage() {
    const path = window.location.pathname.toLowerCase();
    return path.endsWith("/onboarding.html") || path.includes("/onboarding.html");
}

function enforceOnboarding() {
    if (typeof MOCK_MODE !== "undefined" && MOCK_MODE) return;
    if (!isStaffAdminPage()) return;
    if (!getOnboardingFlag()) return;
    if (isOnboardingPage()) return;

    navigateTo("./onboarding.html");
}

function getSessionRole() {
    try {
        const user = JSON.parse(sessionStorage.getItem("user") || "{}");
        return String(user.role || "").toUpperCase();
    } catch (_) {
        return "";
    }
}

// ==============================================
// NAVIGATION (MULTI-PAGE)
// ==============================================

function navigateTo(page) {
    window.location.href = page;
}

function getSignInPagePath() {
    const isStaffPage = window.location.pathname
        .toLowerCase()
        .includes("/pages/staff_admin/");
    return isStaffPage ? "../../index.html" : "./index.html";
}

function logLoginDebugSnapshot(stage) {
    const loginScreen = document.getElementById("login-screen");
    const loginForm = document.getElementById("login-form");
    const emailInput = document.getElementById("login-email");
    const passwordInput = document.getElementById("login-password");
    const successModal = document.getElementById("success-modal");
    const logoutModal = document.getElementById("logoutModal");
    const guestLoadingOverlay = document.getElementById("guestLoadingOverlay");
    const mobileOverlay = document.getElementById("mobileOverlay");

    const blockers = Array.from(
        document.querySelectorAll("body *"),
    ).filter((el) => {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const z = Number(style.zIndex);
        if (!Number.isFinite(z) || z < 20) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    });

    const topBlockers = blockers
        .sort(
            (a, b) =>
                Number(window.getComputedStyle(b).zIndex || 0) -
                Number(window.getComputedStyle(a).zIndex || 0),
        )
        .slice(0, 5)
        .map((el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return {
                id: el.id || null,
                className: el.className || null,
                tagName: el.tagName,
                zIndex: style.zIndex,
                pointerEvents: style.pointerEvents,
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                },
            };
        });

    console.debug("[LOGIN_DEBUG] snapshot", {
        stage,
        url: window.location.href,
        bodyPointerEvents: document.body.style.pointerEvents || "(unset)",
        bodyComputedPointerEvents: window.getComputedStyle(document.body).pointerEvents,
        loginScreen: loginScreen
            ? {
                  className: loginScreen.className,
                  inlinePointerEvents: loginScreen.style.pointerEvents || "(unset)",
                  computedPointerEvents: window.getComputedStyle(loginScreen).pointerEvents,
              }
            : null,
        loginFormControls: loginForm
            ? Array.from(
                  loginForm.querySelectorAll("input, button, select, textarea"),
              ).map((el) => ({
                  id: el.id || null,
                  tagName: el.tagName,
                  type: el.type || null,
                  disabled: !!el.disabled,
                  readOnly: !!el.readOnly,
                  pointerEvents: window.getComputedStyle(el).pointerEvents,
              }))
            : null,
        overlays: {
            successModal: successModal
                ? {
                      className: successModal.className,
                      display: window.getComputedStyle(successModal).display,
                  }
                : null,
            logoutModal: logoutModal
                ? {
                      className: logoutModal.className,
                      display: window.getComputedStyle(logoutModal).display,
                  }
                : null,
            guestLoadingOverlay: guestLoadingOverlay
                ? {
                      className: guestLoadingOverlay.className,
                      display: window.getComputedStyle(guestLoadingOverlay).display,
                      pointerEvents: window.getComputedStyle(guestLoadingOverlay)
                          .pointerEvents,
                  }
                : null,
            mobileOverlay: mobileOverlay
                ? {
                      className: mobileOverlay.className,
                      display: window.getComputedStyle(mobileOverlay).display,
                  }
                : null,
        },
        elementFromPointAtEmail:
            emailInput && emailInput.getBoundingClientRect().width > 0
                ? (() => {
                      const rect = emailInput.getBoundingClientRect();
                      const x = Math.floor(rect.left + rect.width / 2);
                      const y = Math.floor(rect.top + rect.height / 2);
                      const topEl = document.elementFromPoint(x, y);
                      return topEl
                          ? {
                                x,
                                y,
                                id: topEl.id || null,
                                className: topEl.className || null,
                                tagName: topEl.tagName,
                            }
                          : null;
                  })()
                : null,
        passwordInputPresent: !!passwordInput,
        topBlockers,
    });
}

function normalizeLoginPageState() {
    const loginScreen = document.getElementById("login-screen");
    if (!loginScreen) return;

    logLoginDebugSnapshot("before-normalize");

    // Ensure no stale overlay/modal from previous navigation can block inputs.
    const successModal = document.getElementById("success-modal");
    if (successModal) {
        successModal.classList.remove("active");
        successModal.style.cssText = "display:none;";
    }

    ["logoutModal", "guestLoadingOverlay", "mobileOverlay"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove("active", "show", "flex");
        el.classList.add("hidden");
        el.style.display = "none";
    });

    document.body.style.pointerEvents = "auto";
    loginScreen.style.pointerEvents = "auto";

    const loginForm = document.getElementById("login-form");
    if (loginForm) {
        loginForm
            .querySelectorAll("input, button, select, textarea")
            .forEach((el) => {
                el.disabled = false;
            });
    }

    // Clear logout hint query param (if present) after state reset.
    const url = new URL(window.location.href);
    if (url.searchParams.has("from_logout")) {
        url.searchParams.delete("from_logout");
        const next =
            url.pathname +
            (url.searchParams.toString()
                ? `?${url.searchParams.toString()}`
                : "") +
            url.hash;
        window.history.replaceState({}, "", next);
    }

    logLoginDebugSnapshot("after-normalize");
}

// ==============================================
// TOAST NOTIFICATIONS
// ==============================================

function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    const toastMessage = document.getElementById("toast-message");

    if (!toast || !toastMessage) return;

    toast.classList.remove("toast-success", "toast-error", "toast-info");
    toast.classList.add(`toast-${type}`);

    toastMessage.textContent = message;
    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

// ==============================================
// MODAL MANAGEMENT
// ==============================================

function showSuccessModal(title, subtitle) {
    const modal = document.getElementById("success-modal");
    if (!modal) return;

    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-subtitle").textContent = subtitle;
    modal.classList.add("active");
    modal.style.cssText = "display:flex;position:fixed;inset:0;z-index:9000;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);";
}

function closeModal() {
    const modal = document.getElementById("success-modal");
    if (!modal) return;

    modal.classList.remove("active");
    modal.style.cssText = "display:none;";
    navigateTo(getSignInPagePath());
}

// ==============================================
// FORM HANDLERS (LOGIN / RESET PASSWORD)
// ==============================================

document.addEventListener("submit", async (e) => {
    // ------------------------------
    // LOGIN FORM
    // ------------------------------
    if (e.target.id === "login-form") {
        e.preventDefault();

        const loginId = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;

        if (!loginId || !password) {
            showToast("Please fill in all fields", "error");
            return;
        }

        try {
            // TODO: API CALL
            // POST /auth/login
            const result = await API.login(loginId, password);

            if (!result.success) throw new Error(result.error);

            AppState.currentUser = result.user;
            setOnboardingFlag(!!result.needs_profile_setup);
            showToast("Login successful!", "success");

            if (result.needs_profile_setup && !MOCK_MODE) {
                navigateTo("./pages/staff_admin/onboarding.html");
            } else {
                navigateTo("./pages/staff_admin/shell.html");
            }
        } catch (error) {
            showToast(error.message || "Login failed", "error");
        }
    }

    // ------------------------------
    // CREATE STAFF FORM
    // ------------------------------
    if (e.target.id === "signup-form") {
        e.preventDefault();

        const firstName = document.getElementById("signup-first-name").value.trim();
        const lastName = document.getElementById("signup-last-name").value.trim();
        const phoneNumber = document
            .getElementById("signup-phone-number")
            .value.trim();
        const nickname = document.getElementById("signup-nickname").value.trim();
        const username = document.getElementById("signup-username").value.trim();
        const email = document.getElementById("signup-email").value.trim();
        const password = document.getElementById("signup-password").value.trim();
        const confirm = document.getElementById("signup-confirm").value.trim();
        const roleEl = document.getElementById("signup-role");
        const role =
            getSessionRole() === "OWNER"
                ? (roleEl ? roleEl.value : "STAFF").toUpperCase()
                : "STAFF";

        if (
            !firstName ||
            !lastName ||
            !username ||
            !email
        ) {
            const msg = "Please fill in all fields";
            showToast(msg, "error");
            alert(msg);
            return;
        }
        if ((password || confirm) && password !== confirm) {
            const msg = "Passwords do not match";
            showToast(msg, "error");
            alert(msg);
            return;
        }

        try {
            const signupPayload = {
                first_name: firstName,
                last_name: lastName,
                phone_number: phoneNumber,
                nickname,
                username,
                email,
                role,
            };
            if (password) {
                signupPayload.password = password;
            }
            const result = await API.signup(signupPayload);
            if (!result.success) throw new Error(result.error);
            showToast(result.message || "Staff account created", "success");
            if (result.temporary_password) {
                alert(
                    `Staff created successfully.\nDefault password: ${result.temporary_password}`,
                );
            }
            e.target.reset();
        } catch (error) {
            const msg = error.message || "Failed to create account";
            showToast(msg, "error");
            alert(msg);
        }
    }

    // ------------------------------
    // FORGOT PASSWORD FORM
    // ------------------------------
    if (e.target.id === "reset-form") {
        e.preventDefault();

        const email = document.getElementById("reset-email").value.trim();
        const submitBtn = document.getElementById("reset-submit-btn");
        const feedbackEl = document.getElementById("reset-feedback");
        if (!email) {
            showToast("Please provide your staff email", "error");
            return;
        }

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.classList.add("opacity-70", "cursor-not-allowed");
                submitBtn.textContent = "Submitting...";
            }
            if (feedbackEl) {
                feedbackEl.classList.remove("hidden");
                feedbackEl.textContent =
                    "Sending request for superuser approval...";
            }
            const result = await API.resetPassword(email);
            if (!result.success) throw new Error(result.error);

            showSuccessModal(
                "Request submitted",
                result.message ||
                    "If your account exists, a superuser must approve the request first.",
            );
        } catch (error) {
            if (feedbackEl) {
                feedbackEl.classList.remove("hidden");
                feedbackEl.textContent =
                    error.message || "Unable to submit request at this time.";
            }
            showToast(error.message || "Unable to reset password", "error");
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.classList.remove("opacity-70", "cursor-not-allowed");
                submitBtn.textContent = "Request Temporary Password";
            }
        }
    }
});

// ==============================================
// LOGOUT
// ==============================================

function performLogout() {
    // TODO: API CALL (optional)
    // POST /auth/logout

    AppState.currentUser = null;
    AppState.customers = [];
    AppState.packages = [];
    AppState.addons = [];
    setOnboardingFlag(false);

    navigateTo(getSignInPagePath());
}

function logout() {
    if (!confirm("Are you sure you want to logout?")) return;
    performLogout();
}

window.openLogoutModal = function openLogoutModal(e) {
    if (e && e.preventDefault) e.preventDefault();
    const modal = document.getElementById("logoutModal");
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
};

window.closeLogoutModal = function closeLogoutModal() {
    const modal = document.getElementById("logoutModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
};

// Called from the in-page logout modal — do not use native confirm() again.
window.confirmLogout = function confirmLogout() {
    if (typeof window.closeLogoutModal === "function") {
        try {
            window.closeLogoutModal();
        } catch (_) {}
    }
    performLogout();
};

// ==============================================
// PAGE INITIALIZATION (AUTO LOAD DATA)
// ==============================================

document.addEventListener("DOMContentLoaded", () => {
    console.debug("[LOGIN_DEBUG] DOMContentLoaded", {
        url: window.location.href,
    });
    normalizeLoginPageState();
    enforceOnboarding();

    if (document.getElementById("dashboard-screen")) {
        loadDashboardData();
    }

    if (document.getElementById("customers-screen")) {
        loadCustomersData();
    }

    if (document.getElementById("packages-screen")) {
        loadPackagesData();
    }

    const signupRoleEl = document.getElementById("signup-role");
    const signupRoleWrap = document.getElementById("signup-role-wrap");
    if (signupRoleEl && signupRoleWrap && getSessionRole() !== "OWNER") {
        signupRoleWrap.classList.add("hidden");
        signupRoleEl.value = "STAFF";
    }
});

window.addEventListener("pageshow", (event) => {
    console.debug("[LOGIN_DEBUG] pageshow", {
        url: window.location.href,
        persisted: !!event.persisted,
    });
    normalizeLoginPageState();
});

document.addEventListener(
    "click",
    (event) => {
        const target = event.target;
        if (!target) return;
        if (
            target.id === "login-email" ||
            target.id === "login-password" ||
            target.closest("#login-form")
        ) {
            logLoginDebugSnapshot(`login-form-click:${target.id || target.tagName}`);
        }
    },
    true,
);

document.addEventListener(
    "focusin",
    (event) => {
        const target = event.target;
        if (!target) return;
        if (target.id === "login-email" || target.id === "login-password") {
            console.debug("[LOGIN_DEBUG] focusin", {
                id: target.id,
                disabled: !!target.disabled,
                readOnly: !!target.readOnly,
            });
        }
    },
    true,
);
