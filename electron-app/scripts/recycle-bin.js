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
        if (kind === "coupons") return c.coupons;
        if (kind === "addons") return c.addons;
        return null;
    }

    function renderRow(kind, item, primary, secondary) {
        var id = item.id;
        var deletedAt = item.deleted_at;
        var api = apiFor(kind);
        var restoreFn = "recycleRestore('" + kind + "'," + id + ")";
        var purgeFn = "recyclePurge('" + kind + "'," + id + ")";
        return (
            '<tr class="border-b border-gray-100">' +
            '<td class="px-3 py-2 align-top font-semibold text-[#165166]">' +
            escapeHtml(primary) +
            "</td>" +
            '<td class="px-3 py-2 align-top text-xs text-[#5F6E79]">' +
            escapeHtml(secondary || "") +
            "</td>" +
            '<td class="px-3 py-2 align-top text-xs text-[#5F6E79] whitespace-nowrap">' +
            formatWhen(deletedAt) +
            "</td>" +
            '<td class="px-3 py-2 align-top text-right whitespace-nowrap">' +
            (api
                ? '<button type="button" onclick="' +
                  restoreFn +
                  '" class="mr-1 rounded-full bg-[#165166] text-white text-[11px] font-bold px-3 py-1 hover:bg-[#134152]">Restore</button>' +
                  '<button type="button" onclick="' +
                  purgeFn +
                  '" class="rounded-full border border-red-400 text-red-700 text-[11px] font-bold px-3 py-1 hover:bg-red-50">Delete forever</button>'
                : "") +
            "</td>" +
            "</tr>"
        );
    }

    function renderSection(title, kind, rowsHtml) {
        if (!rowsHtml) return "";
        return (
            '<section class="bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">' +
            '<div class="bg-[#4F6E79] text-white px-4 py-2 text-sm font-bold">' +
            escapeHtml(title) +
            "</div>" +
            '<div class="overflow-x-auto">' +
            '<table class="w-full text-sm text-left">' +
            "<thead><tr class=" +
            '"bg-gray-50 text-[10px] uppercase tracking-wide text-[#5F6E79]">' +
            '<th class="px-3 py-2">Item</th>' +
            '<th class="px-3 py-2">Details</th>' +
            '<th class="px-3 py-2">Removed</th>' +
            '<th class="px-3 py-2 text-right">Actions</th>' +
            "</tr></thead>" +
            "<tbody>" +
            rowsHtml +
            "</tbody></table></div></section>"
        );
    }

    function render(data) {
        var packages = data.packages || [];
        var categories = data.categories || [];
        var coupons = data.coupons || [];
        var addons = data.addons || [];

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

        var coupRows = coupons
            .map(function (c) {
                return renderRow(
                    "coupons",
                    c,
                    c.code || "Coupon",
                    (c.discount_type || "") +
                        (c.discount_value != null ? " · " + c.discount_value : ""),
                );
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

        var html =
            renderSection("Packages", "packages", pkgRows) +
            renderSection("Categories", "categories", catRows) +
            renderSection("Coupons", "coupons", coupRows) +
            renderSection("Add-ons", "addons", addonRows);

        var emptyEl = document.getElementById("recycleEmpty");
        var sectionsEl = document.getElementById("recycleSections");
        var any =
            packages.length ||
            categories.length ||
            coupons.length ||
            addons.length;

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
            setState(false, (e && e.message) || "Failed to load recycle bin.");
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
                window.alert("Package restored. Its category was also restored from the recycle bin.");
            } else if (res && res.packages_co_restored > 0) {
                window.alert(
                    "Category restored. " +
                        res.packages_co_restored +
                        " related package(s) in the recycle bin were restored too.",
                );
            }
        } catch (e) {
            window.alert((e && e.message) || "Restore failed.");
        }
    }

    async function doPurge(kind, id) {
        var api = apiFor(kind);
        if (!api || typeof api.purge !== "function") return;
        var ok = await window.heigenConfirm(
            "Permanently delete this item? This cannot be undone.",
            {
                title: "Delete forever",
                confirmText: "Delete forever",
                dangerous: true,
            },
        );
        if (!ok) return;
        try {
            await api.purge(id);
            await loadBin();
        } catch (e) {
            window.alert((e && e.message) || "Permanent delete failed.");
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
