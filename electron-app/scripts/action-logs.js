(function actionLogsPage() {
    var ACTION_TYPE_LABELS = {
        login: "Login",
        customer_bulk_deleted: "Customers bulk deleted",
        customer_created: "Customer created",
        customer_updated: "Customer updated",
        customer_deleted: "Customer deleted",
        booking_status_updated: "Booking status updated",
        booking_created: "Booking created",
        booking_updated: "Booking updated",
        booking_deleted: "Booking deleted",
        package_created: "Package created",
        package_updated: "Package updated",
        package_deleted: "Package deleted",
        package_recycled: "Package moved to recycle bin",
        package_restored: "Package restored from recycle bin",
        package_purged: "Package permanently deleted",
        category_created: "Category created",
        category_updated: "Category updated",
        category_deleted: "Category deleted",
        category_recycled: "Category moved to recycle bin",
        category_restored: "Category restored from recycle bin",
        category_purged: "Category permanently deleted",
        addon_created: "Addon created",
        addon_updated: "Addon updated",
        addon_deleted: "Addon deleted",
        addon_recycled: "Add-on moved to recycle bin",
        addon_restored: "Add-on restored from recycle bin",
        addon_purged: "Add-on permanently deleted",
        coupon_created: "Coupon created",
        coupon_updated: "Coupon updated",
        coupon_deleted: "Coupon deleted",
        coupon_recycled: "Coupon moved to recycle bin",
        coupon_restored: "Coupon restored from recycle bin",
        coupon_purged: "Coupon permanently deleted",
        coupon_registered: "Coupon registered",
        coupon_email_sent: "Coupon email sent",
        bookings_import_batch: "Bookings import batch",
        recommendation_rebuild: "Recommendation rebuild",
        recommendation_metrics_recomputed: "Recommendation metrics recomputed",
        staff_created: "Staff account created",
        staff_account_updated: "Staff account updated",
        staff_account_deleted: "Staff account deleted",
        account_deleted: "Account deleted",
        admin_account_updated: "Admin account updated",
        owner_account_updated: "Owner account updated",
        profile_nickname_changed: "Profile nickname changed",
        profile_password_changed: "Profile password changed",
        profile_username_changed: "Profile username changed",
        email_template_created: "Email template created",
        email_template_updated: "Email template updated",
        email_template_deleted: "Email template deleted",
    };

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getRole() {
        if (window.staffAuth && typeof window.staffAuth.getRole === "function") {
            return window.staffAuth.getRole();
        }
        try {
            var user = JSON.parse(sessionStorage.getItem("user") || "{}");
            return String(user.role || "").toUpperCase();
        } catch (e) {
            return "";
        }
    }

    function canViewLogs() {
        if (window.staffAuth && typeof window.staffAuth.canSeeActionLogs === "function") {
            return window.staffAuth.canSeeActionLogs(getRole());
        }
        var role = getRole();
        return role === "ADMIN" || role === "OWNER";
    }

    function formatDateTime(isoValue) {
        if (!isoValue) return "-";
        var dt = new Date(isoValue);
        if (Number.isNaN(dt.getTime())) return String(isoValue);
        return dt.toLocaleString("en-PH", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function setVisibleState(state) {
        var loading = document.getElementById("logsLoading");
        var empty = document.getElementById("logsEmpty");
        var table = document.getElementById("logsTableWrap");
        if (!loading || !empty || !table) return;
        loading.classList.toggle("hidden", state !== "loading");
        empty.classList.toggle("hidden", state !== "empty");
        table.classList.toggle("hidden", state !== "table");
    }

    function readFilters() {
        var searchEl = document.getElementById("logsSearchInput");
        var actorEl = document.getElementById("logsActorFilter");
        var typeEl = document.getElementById("logsTypeFilter");
        var fromEl = document.getElementById("logsDateFrom");
        var toEl = document.getElementById("logsDateTo");
        return {
            limit: 250,
            q: searchEl ? String(searchEl.value || "").trim() : "",
            actor: actorEl ? String(actorEl.value || "").trim() : "",
            action_type: typeEl ? String(typeEl.value || "").trim() : "all",
            date_from: fromEl ? String(fromEl.value || "").trim() : "",
            date_to: toEl ? String(toEl.value || "").trim() : "",
        };
    }

    function humanizeActionType(actionType) {
        if (!actionType) return "Unknown";
        if (ACTION_TYPE_LABELS[actionType]) return ACTION_TYPE_LABELS[actionType];
        return String(actionType)
            .split("_")
            .filter(Boolean)
            .map(function (part) {
                return part.charAt(0).toUpperCase() + part.slice(1);
            })
            .join(" ");
    }

    function updateTypeFilterOptions(rows) {
        var typeEl = document.getElementById("logsTypeFilter");
        if (!typeEl) return;
        var selected = String(typeEl.value || "all");
        var knownTypes = Object.keys(ACTION_TYPE_LABELS);
        var rowTypes = Array.isArray(rows)
            ? rows
                .map(function (row) {
                    return String(row && row.action_type ? row.action_type : "").trim();
                })
                .filter(Boolean)
            : [];
        var uniqueTypes = Array.from(new Set(knownTypes.concat(rowTypes))).sort();
        typeEl.innerHTML = "<option value='all'>All</option>" + uniqueTypes
            .map(function (type) {
                return (
                    "<option value='" + escapeHtml(type) + "'>" + escapeHtml(humanizeActionType(type)) + "</option>"
                );
            })
            .join("");
        typeEl.value = uniqueTypes.indexOf(selected) >= 0 ? selected : "all";
    }

    function renderRows(rows) {
        var body = document.getElementById("actionLogsBody");
        if (!body) return;
        body.innerHTML = rows
            .map(function (row) {
                return [
                    "<tr class='border-b hover:bg-gray-50'>",
                    "<td class='px-4 py-3 whitespace-nowrap'>" + escapeHtml(formatDateTime(row.created_at)) + "</td>",
                    "<td class='px-4 py-3 whitespace-nowrap'>" + escapeHtml(row.actor_label || "System") + "</td>",
                    "<td class='px-4 py-3'>" + escapeHtml(row.action_text || "") + "</td>",
                    "<td class='px-4 py-3 whitespace-nowrap'><span class='inline-flex rounded-full bg-[#E7EEF0] text-[#165166] text-xs px-2 py-1 font-semibold'>" + escapeHtml(row.action_type || "") + "</span></td>",
                    "</tr>",
                ].join("");
            })
            .join("");
    }

    async function loadActionLogs() {
        if (!window.apiClient || !window.apiClient.actionLogs) return;
        setVisibleState("loading");
        try {
            var rows = await window.apiClient.actionLogs.list(readFilters());
            updateTypeFilterOptions(rows);
            if (!Array.isArray(rows) || rows.length === 0) {
                setVisibleState("empty");
                return;
            }
            renderRows(rows);
            setVisibleState("table");
        } catch (err) {
            console.error("[action-logs] failed:", err);
            setVisibleState("empty");
            window.heigenAlert(err && err.message ? err.message : "Failed to load action logs.");
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        if (!canViewLogs()) {
            window.heigenAlert("Only ADMIN or OWNER can access action logs.");
            var target = new URL("./dashboard.html?embed=1", window.location.href).href;
            window.location.href = target;
            return;
        }

        updateTypeFilterOptions([]);
        var refreshBtn = document.getElementById("refreshActionLogsBtn");
        var applyBtn = document.getElementById("applyLogsFilterBtn");
        var clearBtn = document.getElementById("clearLogsFilterBtn");
        var searchInput = document.getElementById("logsSearchInput");
        var actorInput = document.getElementById("logsActorFilter");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", loadActionLogs);
        }
        if (applyBtn) {
            applyBtn.addEventListener("click", loadActionLogs);
        }
        if (clearBtn) {
            clearBtn.addEventListener("click", function () {
                var typeEl = document.getElementById("logsTypeFilter");
                var fromEl = document.getElementById("logsDateFrom");
                var toEl = document.getElementById("logsDateTo");
                if (searchInput) searchInput.value = "";
                if (actorInput) actorInput.value = "";
                if (typeEl) typeEl.value = "all";
                if (fromEl) fromEl.value = "";
                if (toEl) toEl.value = "";
                loadActionLogs();
            });
        }
        if (searchInput) {
            searchInput.addEventListener("keydown", function (ev) {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    loadActionLogs();
                }
            });
        }
        if (actorInput) {
            actorInput.addEventListener("keydown", function (ev) {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    loadActionLogs();
                }
            });
        }
        loadActionLogs();
    });
})();
