// Local "Add to Package" lists per category (staff-side). Not synced to server.
(function (global) {
    const LS_KEY = "heigen_package_flow_v1";

    function read() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            const o = raw ? JSON.parse(raw) : {};
            return o && typeof o === "object" ? o : {};
        } catch (_) {
            return {};
        }
    }

    function write(data) {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(data));
        } catch (_) {}
    }

    global.PackageFlowStorage = {
        /**
         * @param {string} categoryName
         * @param {object} item
         */
        add(categoryName, item) {
            const cat =
                String(categoryName || "Uncategorized").trim() || "Uncategorized";
            const data = read();
            if (!Array.isArray(data[cat])) data[cat] = [];
            data[cat].push({
                ...item,
                addedAt: new Date().toISOString(),
            });
            write(data);
        },

        listCategories() {
            return Object.keys(read()).sort((a, b) => a.localeCompare(b));
        },

        getForCategory(categoryName) {
            const data = read();
            return Array.isArray(data[categoryName]) ? data[categoryName] : [];
        },
    };
})(typeof window !== "undefined" ? window : globalThis);
