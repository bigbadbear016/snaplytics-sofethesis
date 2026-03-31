(function actionLogsPage() {
    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getRole() {
        try {
            var user = JSON.parse(sessionStorage.getItem("user") || "{}");
            return String(user.role || "").toUpperCase();
        } catch (e) {
            return "";
        }
    }

    function canViewLogs() {
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
            if (!Array.isArray(rows) || rows.length === 0) {
                setVisibleState("empty");
                return;
            }
            renderRows(rows);
            setVisibleState("table");
        } catch (err) {
            console.error("[action-logs] failed:", err);
            setVisibleState("empty");
            alert(err && err.message ? err.message : "Failed to load action logs.");
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        if (!canViewLogs()) {
            alert("Only ADMIN or OWNER can access action logs.");
            var target = new URL("./dashboard.html?embed=1", window.location.href).href;
            window.location.href = target;
            return;
        }

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
