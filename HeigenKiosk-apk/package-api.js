// package-api.js  (Admin site — updated)
// ─────────────────────────────────────────────────────────────────────────────
// Admin category grid. Data now comes from the standalone Supabase/PostgREST backend.
// CRUD functions are wired but can be commented out if not yet needed.
// ─────────────────────────────────────────────────────────────────────────────

import {
    getCategories,
    getPackagesByCategory,
    getAddonsByCategory,
    refreshRecommender,
} from './shared_package_data.js';

let categories = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function loadCategories() {
    try {
        categories = await getCategories();
        renderCategories();
    } catch (err) {
        console.error('Failed to load categories:', err);
        const grid = document.getElementById('categoriesGrid');
        if (grid) {
            grid.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#dc2626;">
                    <p style="font-size:1.125rem;font-weight:600;">Could not load categories</p>
                    <p style="margin-top:0.5rem;color:#717182;">${err.message}</p>
                    <button onclick="loadCategories()" style="margin-top:1rem;padding:0.75rem 1.5rem;
                        background:#d97706;color:#fff;border:none;border-radius:0.75rem;cursor:pointer;font-size:1rem;">
                        Retry
                    </button>
                </div>`;
        }
    }
}

// ── Recommender refresh (admin button) ─────────────────────────────────────────
window.refreshRecommenderData = async function refreshRecommenderData() {
    const btn = document.getElementById('refreshRecommenderBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Refreshing...';
    }

    const result = await refreshRecommender();

    if (btn) {
        btn.disabled = false;
        btn.textContent = '✦ Refresh AI Recommendations';
    }

    // Show toast notification
    showToast(
        result.success
            ? `✓ ${result.message}`
            : `⚠ ${result.message}`,
        result.success ? 'success' : 'warning'
    );
};

function showToast(message, type = 'success') {
    const existing = document.getElementById('adminToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'adminToast';
    const bg = type === 'success' ? '#ecfdf5' : 'rgba(217,119,6,0.1)';
    const border = type === 'success' ? '#6ee7b7' : 'rgba(217,119,6,0.4)';
    const color = type === 'success' ? '#065f46' : '#92400e';
    toast.style.cssText = `
        position:fixed; bottom:2rem; right:2rem; z-index:9999;
        background:${bg}; border:1.5px solid ${border}; color:${color};
        padding:1rem 1.5rem; border-radius:1rem;
        box-shadow:0 10px 25px rgba(0,0,0,0.1);
        font-size:0.9rem; font-weight:600; max-width:360px;
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

// ── Sidebar / nav ─────────────────────────────────────────────────────────────
window.toggleMobileSidebar = function(show) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (show) {
        sidebar?.classList.add('mobile-open');
        overlay?.classList.add('show');
    } else {
        sidebar?.classList.remove('mobile-open');
        overlay?.classList.remove('show');
    }
};

window.navigateTo = function(section) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

    document.getElementById(section)?.classList.add('active');

    const sectionIndexMap = {
        'dashboard': 0, 'customer-data': 1, 'package-list': 2,
        'survey-form': 3, 'edit-profile': 5, 'logout': 6,
    };
    const idx = sectionIndexMap[section];
    if (idx !== undefined) {
        document.querySelectorAll('.nav-item')[idx]?.classList.add('active');
    }
};

// ── Category rendering ─────────────────────────────────────────────────────────
function renderCategories() {
    const grid = document.getElementById('categoriesGrid');
    if (!grid) return;
    grid.innerHTML = '';

    categories.forEach((category) => {
        const card = document.createElement('div');
        card.className = 'flex flex-col rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow';
        card.innerHTML = `
            <div onclick="navigateToPackagesList('${encodeURIComponent(category.name)}')" class="cursor-pointer">
                <img src="${category.image || ''}" alt="${category.name}"
                    class="w-full h-[156px] object-cover rounded-t-2xl"
                    onerror="this.src='https://api.builder.io/api/v1/image/assets/TEMP/c85bfb6836c45dfd4826c29c28b7e2b3c390cf02?width=648'">
            </div>
            <div class="flex items-center p-3 bg-white">
                <div class="flex-1 text-center">
                    <p class="text-[#4F6E79] font-segoe text-base font-bold">${category.name}</p>
                </div>
                <button onclick="openEditModal('${category.id}')" class="flex-shrink-0 p-2 hover:bg-gray-100 rounded">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M9.43299 5.14706H4.16667C3.2462 5.14706 2.5 5.93714 2.5 6.91176V15.7353C2.5 16.7099 3.2462 17.5 4.16667 17.5H13.3334C14.2539 17.5 15.0001 16.7099 15.0001 15.7353V9.27681L11.7386 12.7301C11.4478 13.0381 11.0773 13.248 10.674 13.3334L8.43975 13.8065C6.98199 14.1152 5.69673 12.7544 5.98828 11.2109L6.43514 8.84519C6.5158 8.41815 6.71404 8.02595 7.00487 7.71801L9.43299 5.14706Z" fill="#4F6E79"/>
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M16.5387 3.59866C16.4542 3.38277 16.3303 3.18662 16.1742 3.02142C16.0182 2.85612 15.8329 2.72499 15.629 2.63552C15.4251 2.54605 15.2066 2.5 14.9859 2.5C14.7652 2.5 14.5466 2.54605 14.3427 2.63552C14.1388 2.72499 13.9536 2.85612 13.7975 3.02142L13.3426 3.50308L15.7193 6.01955L16.1742 5.53789C16.3303 5.3727 16.4542 5.17655 16.5387 4.96066C16.6232 4.74476 16.6667 4.51336 16.6667 4.27966C16.6667 4.04596 16.6232 3.81455 16.5387 3.59866ZM14.5408 7.26739L12.1641 4.75092L8.18338 8.96584C8.12522 9.02743 8.08557 9.10587 8.06944 9.19128L7.62258 11.557C7.56427 11.8657 7.82132 12.1378 8.11287 12.0761L10.3471 11.603C10.4278 11.5859 10.5019 11.5439 10.5601 11.4823L14.5408 7.26739Z" fill="#4F6E79"/>
                    </svg>
                </button>
            </div>
        `;
        grid.appendChild(card);
    });

    // Create category button
    const createCard = document.createElement('button');
    createCard.onclick = openCreateModal;
    createCard.className = 'flex flex-col items-center justify-center rounded-2xl border-4 border-dashed border-[#BDDAE0] h-[224px] hover:border-[#9DBAC0] transition-colors';
    createCard.innerHTML = '<p class="text-[#BDDAE0] font-segoe text-base font-bold">CREATE CATEGORY</p>';
    grid.appendChild(createCard);
}

window.navigateToPackagesList = function(categoryName) {
    window.location.href = `packages-list.html?category=${encodeURIComponent(categoryName)}`;
};

// ── CRUD (stub — implement when ready) ─────────────────────────────────────────
window.openEditModal = function(categoryId) {
    console.warn('openEditModal called for', categoryId, '— CRUD not yet wired');
};
function openCreateModal() {
    console.warn('openCreateModal called — CRUD not yet wired');
}
window.saveCreateCategory = function() { console.warn('saveCreateCategory — CRUD not wired'); };
window.saveEditCategory   = function() { console.warn('saveEditCategory — CRUD not wired'); };
window.deleteCategory     = function() { console.warn('deleteCategory — CRUD not wired'); };

// ── Logout modal ──────────────────────────────────────────────────────────────
window.openLogoutModal = function(e) {
    e?.preventDefault();
    document.getElementById('logoutModal')?.classList.remove('hidden');
    document.getElementById('logoutModal')?.classList.add('flex');
};
window.closeLogoutModal = function() {
    document.getElementById('logoutModal')?.classList.add('hidden');
    document.getElementById('logoutModal')?.classList.remove('flex');
};
window.confirmLogout = function() {
    window.location.href = '../index.html';
};

// ── Boot ──────────────────────────────────────────────────────────────────────
loadCategories();
