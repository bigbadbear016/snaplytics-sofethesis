(function actionLogsPage() {
    // Rows per page; each page is one server request at offset (page - 1) * PAGE_SIZE.
    var PAGE_SIZE = 25;
    // Coupon logs are hidden on this page; the server filters them before paging.
    var HIDDEN_TYPE_PREFIX = "coupon_";
    // Filters the current page was loaded with, so paging keeps them.
    var activeFilters = null;

    var ACTION_TYPE_LABELS = {
        login: "Login",
        customer_bulk_deleted: "Customers bulk deleted",
        customers_bulk_recycled: "Customers moved to Internal Records",
        customer_created: "Customer created",
        customer_updated: "Customer updated",
        customer_recycled: "Customer moved to Internal Records",
        customer_restored: "Customer restored from Internal Records",
        customer_purged: "Customer permanently deleted",
        customer_loyalty_claim: "Customer loyalty claim",
        customer_deleted: "Customer deleted",
        booking_status_updated: "Booking status updated",
        booking_accepted: "Booking accepted",
        booking_created: "Booking created",
        booking_updated: "Booking updated",
        booking_deleted: "Booking deleted",
        package_created: "Package created",
        package_updated: "Package updated",
        package_deleted: "Package deleted",
        package_recycled: "Package moved to Internal Records",
        package_restored: "Package restored from Internal Records",
        package_purged: "Package permanently deleted",
        category_created: "Category created",
        category_updated: "Category updated",
        category_deleted: "Category deleted",
        category_recycled: "Category moved to Internal Records",
        category_restored: "Category restored from Internal Records",
        category_purged: "Category permanently deleted",
        addon_created: "Addon created",
        addon_updated: "Addon updated",
        addon_deleted: "Addon deleted",
        addon_recycled: "Add-on moved to Internal Records",
        addon_restored: "Add-on restored from Internal Records",
        addon_purged: "Add-on permanently deleted",
        bookings_import_batch: "Bookings import batch",
        recommendation_rebuild: "Recommendation rebuild",
        recommendation_metrics_recomputed: "Recommendation metrics recomputed",
        staff_created: "Staff account created",
        staff_account_updated: "Staff account updated",
        staff_account_deleted: "Staff account deleted",
        account_recycled: "Account moved to Internal Records",
        account_restored: "Account restored from Internal Records",
        account_purged: "Account permanently deleted",
        account_deleted: "Account deleted",
        admin_account_updated: "Admin account updated",
        owner_account_updated: "Owner account updated",
        profile_nickname_changed: "Profile nickname changed",
        profile_password_changed: "Profile password changed",
        profile_username_changed: "Profile username changed",
        profile_email_changed: "Profile email changed",
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
            limit: PAGE_SIZE,
            exclude_type_prefix: HIDDEN_TYPE_PREFIX,
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

    function isHiddenActionType(actionType) {
        return String(actionType || "").toLowerCase().startsWith(HIDDEN_TYPE_PREFIX);
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
                .filter(function (type) {
                    return !isHiddenActionType(type);
                })
            : [];
        var uniqueTypes = Array.from(new Set(knownTypes.concat(rowTypes)))
            .filter(function (type) {
                return !isHiddenActionType(type);
            })
            .sort();
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
                    "<tr class='action-log-row'>",
                    "<td class='action-log-td action-log-td--time px-4 py-3.5 whitespace-nowrap tabular-nums'>" + escapeHtml(formatDateTime(row.created_at)) + "</td>",
                    "<td class='action-log-td action-log-td--actor px-4 py-3.5 whitespace-nowrap'>" + escapeHtml(row.actor_label || "System") + "</td>",
                    "<td class='action-log-td action-log-td--text px-4 py-3.5'>" + escapeHtml(row.action_text || "") + "</td>",
                    "<td class='action-log-td action-log-td--type px-4 py-3.5 whitespace-nowrap'><span class='action-log-type-pill' title='" + escapeHtml(row.action_type || "") + "'>" + escapeHtml(row.action_type || "") + "</span></td>",
                    "</tr>",
                ].join("");
            })
            .join("");
    }

    // Loads one page with activeFilters and redraws table + pager.
    // Called by the pager buttons as window.actionLogsGoToPage(n).
    async function goToPage(page) {
        if (!activeFilters || !window.apiClient || !window.apiClient.actionLogs) return;
        var cur = Math.max(1, page | 0);
        setVisibleState("loading");
        try {
            var data = await window.apiClient.actionLogs.list(
                Object.assign({}, activeFilters, { offset: (cur - 1) * PAGE_SIZE, with_count: true }),
            );
            var total = Number(data && data.count) || 0;
            var rows = (data && Array.isArray(data.results) ? data.results : []).filter(function (row) {
                return !isHiddenActionType(row && row.action_type);
            });
            // Page past the end (e.g. logs shrank under a filter): jump to the last page.
            if (!rows.length && total > 0 && cur > 1) {
                return goToPage(Math.ceil(total / PAGE_SIZE));
            }
            updateTypeFilterOptions(rows);
            if (!rows.length) {
                renderPager("logsPagination", 1, 0, PAGE_SIZE, "actionLogsGoToPage");
                setVisibleState("empty");
                return;
            }
            renderRows(rows);
            renderPager("logsPagination", cur, total, PAGE_SIZE, "actionLogsGoToPage");
            setVisibleState("table");
        } catch (err) {
            console.error("[action-logs] failed:", err);
            setVisibleState("empty");
            window.heigenAlert(err && err.message ? err.message : "Failed to load action logs.");
        }
    }
    window.actionLogsGoToPage = goToPage;

    function loadActionLogs() {
        activeFilters = readFilters();
        return goToPage(1);
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
                    if (ev.isComposing || ev.keyCode === 229) return;
                    loadActionLogs();
                }
            });
        }
        if (actorInput) {
            actorInput.addEventListener("keydown", function (ev) {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    if (ev.isComposing || ev.keyCode === 229) return;
                    loadActionLogs();
                }
            });
        }
        loadActionLogs();
    });
})();
