(function recycleBinPage() {
    function getRole() {
        if (window.staffAuth && typeof window.staffAuth.getRole === "function") {
            return window.staffAuth.getRole();
        }
        try {
            var u = JSON.parse(sessionStorage.getItem("user") || "{}");
            return String(u.role || "").toUpperCase();
        } catch (e) {
            return "";
        }
    }

    function requireAdminOrBail() {
        var role = getRole();
        var ok =
            window.staffAuth &&
            typeof window.staffAuth.isAdminOrOwner === "function" &&
            window.staffAuth.isAdminOrOwner(role);
        if (ok) return true;
        if (window.self !== window.top) {
            window.parent.postMessage(
                { type: "heigen-staff-nav", page: "dashboard.html" },
                "*",
            );
        } else {
            window.location.href = "./shell.html?page=dashboard.html";
        }
        return false;
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatWhen(iso) {
        if (!iso) return "—";
        try {
            var d = new Date(iso);
            if (Number.isNaN(d.getTime())) return escapeHtml(iso);
            return escapeHtml(d.toLocaleString());
        } catch (e) {
            return escapeHtml(iso);
        }
    }

    function setState(loading, errMsg) {
        var loadEl = document.getElementById("recycleLoading");
        var errEl = document.getElementById("recycleError");
        var emptyEl = document.getElementById("recycleEmpty");
        var sectionsEl = document.getElementById("recycleSections");
        if (loadEl) loadEl.classList.toggle("hidden", !loading);
        if (errEl) {
            errEl.classList.toggle("hidden", !errMsg);
            errEl.textContent = errMsg || "";
        }
        if (loading || errMsg) {
            if (emptyEl) emptyEl.classList.add("hidden");
            if (sectionsEl) sectionsEl.classList.add("hidden");
        }
        if (errMsg && sectionsEl) sectionsEl.innerHTML = "";
    }

    function apiFor(kind) {
        var c = window.apiClient;
        if (!c) return null;
        if (kind === "packages") return c.packages;
        if (kind === "categories") return c.categories;
        if (kind === "addons") return c.addons;
        if (kind === "accounts") {
            return {
                restore: c.auth && c.auth.restoreStaffAccount,
                purge: c.auth && c.auth.purgeStaffAccount,
            };
        }
        if (kind === "customers") {
            return {
                restore: c.customers && c.customers.restore,
                purge: c.customers && c.customers.purge,
            };
        }
        return null;
    }

    /** Backend: POST .../purge/ requires StaffProfile.dev_mode only. */
    function canDevPurgePermanent() {
        if (
            window.staffAuth &&
            typeof window.staffAuth.canPurgeInternalRecords === "function"
        ) {
            return window.staffAuth.canPurgeInternalRecords();
        }
        try {
            var u = JSON.parse(sessionStorage.getItem("user") || "{}");
            return !!u.dev_mode;
        } catch (e) {
            return false;
        }
    }

    function renderRow(kind, item, primary, secondary) {
        var id = item.id;
        var deletedAt = item.deleted_at;
        var api = apiFor(kind);
        var restoreFn = "recycleRestore('" + kind + "'," + id + ")";
        var purgeFn = "recyclePurge('" + kind + "'," + id + ")";
        var purgeBtn = canDevPurgePermanent()
            ? '<button type="button" onclick="' +
              purgeFn +
              '" class="recycle-purge-dev-btn inline-flex min-h-[30px] items-center rounded-full border border-red-400 px-3 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50" title="Dev account only — cannot be undone">Purge (Dev)</button>'
            : "";
        return (
            "<tr>" +
            '<td class="px-4 py-3 align-top heigen-td-strong">' +
            escapeHtml(primary) +
            "</td>" +
            '<td class="px-4 py-3 align-top text-xs">' +
            escapeHtml(secondary || "") +
            "</td>" +
            '<td class="px-4 py-3 align-top text-xs whitespace-nowrap">' +
            formatWhen(deletedAt) +
            "</td>" +
            '<td class="px-4 py-3 align-top text-right whitespace-nowrap">' +
            (api
                ? '<button type="button" onclick="' +
                  restoreFn +
                  '" class="staff-btn-primary mr-1 inline-flex min-h-[30px] items-center rounded-full px-3 py-1 text-[11px] font-bold shadow-sm">Restore</button>' +
                  purgeBtn
                : "") +
            "</td>" +
            "</tr>"
        );
    }

    function renderSection(title, kind, rowsHtml) {
        if (!rowsHtml) return "";
        return (
            '<section class="flex flex-col gap-4 scroll-mt-4">' +
            '<p class="staff-eyebrow mb-0 px-0.5">' +
            escapeHtml(title) +
            "</p>" +
            '<div class="heigen-surface overflow-x-auto max-w-full heigen-table-wrap rounded-2xl shadow-sm">' +
            '<table class="w-full min-w-[560px] text-sm text-left heigen-table">' +
            '<thead class="text-white">' +
            "<tr>" +
            '<th class="px-4 py-3 text-left">Item</th>' +
            '<th class="px-4 py-3 text-left">Details</th>' +
            '<th class="px-4 py-3 text-left">Removed</th>' +
            '<th class="px-4 py-3 text-right">Actions</th>' +
            "</tr></thead>" +
            "<tbody>" +
            rowsHtml +
            "</tbody></table></div></section>"
        );
    }

    function render(data) {
        var packages = data.packages || [];
        var categories = data.categories || [];
        var addons = data.addons || [];
        var customers = data.customers || [];
        var accounts = data.accounts || [];

        var pkgRows = packages
            .map(function (p) {
                return renderRow(
                    "packages",
                    p,
                    p.name || "Package",
                    (p.category ? "Category: " + p.category : "") +
                        (p.price != null ? " · ₱" + p.price : ""),
                );
            })
            .join("");

        var catRows = categories
            .map(function (c) {
                return renderRow("categories", c, c.name || "Category", "");
            })
            .join("");

        var addonRows = addons
            .map(function (a) {
                return renderRow(
                    "addons",
                    a,
                    a.name || "Add-on",
                    a.price != null ? "₱" + a.price : "",
                );
            })
            .join("");

        var customerRows = customers
            .map(function (cust) {
                return renderRow(
                    "customers",
                    cust,
                    cust.name || "Customer",
                    cust.email ? cust.email : "",
                );
            })
            .join("");

        var accountRows = accounts
            .map(function (a) {
                return renderRow(
                    "accounts",
                    a,
                    a.name || a.username || "Account",
                    (a.role ? "Role: " + a.role : "") +
                        (a.email ? " · " + a.email : "") +
                        (a.username ? " · @" + a.username : ""),
                );
            })
            .join("");

        var html =
            renderSection("Packages", "packages", pkgRows) +
            renderSection("Categories", "categories", catRows) +
            renderSection("Add-ons", "addons", addonRows) +
            renderSection("Customers", "customers", customerRows) +
            renderSection("Accounts", "accounts", accountRows);

        var emptyEl = document.getElementById("recycleEmpty");
        var sectionsEl = document.getElementById("recycleSections");
        var any =
            packages.length ||
            categories.length ||
            addons.length ||
            customers.length ||
            accounts.length;

        if (!any) {
            if (emptyEl) emptyEl.classList.remove("hidden");
            if (sectionsEl) {
                sectionsEl.classList.add("hidden");
                sectionsEl.innerHTML = "";
            }
        } else {
            if (emptyEl) emptyEl.classList.add("hidden");
            if (sectionsEl) {
                sectionsEl.innerHTML = html;
                sectionsEl.classList.remove("hidden");
            }
        }
    }

    async function loadBin() {
        if (!requireAdminOrBail()) return;
        setState(true, "");
        try {
            var data = await window.apiClient.recycleBin.list();
            setState(false, "");
            render(data || {});
        } catch (e) {
            setState(false, (e && e.message) || "Failed to load Internal Records.");
        }
    }

    async function doRestore(kind, id) {
        var api = apiFor(kind);
        if (!api || typeof api.restore !== "function") return;
        var ok = await window.heigenConfirm("Restore this item? It will reappear in the main lists.", {
            title: "Restore",
            confirmText: "Restore",
            dangerous: false,
        });
        if (!ok) return;
        try {
            var res = await api.restore(id);
            await loadBin();
            if (res && res.category_co_restored) {
                window.heigenAlert("Package restored. Its category was also restored from Internal Records.");
            } else if (res && res.packages_co_restored > 0) {
                window.heigenAlert(
                    "Category restored. " +
                        res.packages_co_restored +
                        " related package(s) in Internal Records were restored too.",
                );
            }
        } catch (e) {
            window.heigenAlert((e && e.message) || "Restore failed.");
        }
    }

    async function doPurge(kind, id) {
        if (!canDevPurgePermanent()) {
            window.heigenAlert(
                "Permanent purge is restricted to Dev-tier accounts (StaffProfile dev_mode).",
            );
            return;
        }
        var api = apiFor(kind);
        if (!api || typeof api.purge !== "function") return;
        var ok = await window.heigenConfirm(
            "Permanently purge this item from the database? Dev-only — cannot be undone.",
            {
                title: "Permanent purge (Dev)",
                confirmText: "Purge permanently",
                dangerous: true,
            },
        );
        if (!ok) return;
        try {
            await api.purge(id);
            await loadBin();
        } catch (e) {
            window.heigenAlert((e && e.message) || "Purge failed.");
        }
    }

    window.recycleRestore = function (kind, id) {
        doRestore(kind, id);
    };
    window.recyclePurge = function (kind, id) {
        doPurge(kind, id);
    };

    document.addEventListener("DOMContentLoaded", function () {
        if (!requireAdminOrBail()) return;
        var btn = document.getElementById("recycleRefreshBtn");
        if (btn) btn.addEventListener("click", function () {
            loadBin();
        });
        loadBin();
    });
})();
