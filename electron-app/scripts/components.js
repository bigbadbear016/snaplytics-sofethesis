// Reusable Component Templates

const Components = {
    // Sidebar Component
    sidebar: (activePage) => `
        <div class="heigen-sidebar w-64 flex-shrink-0 shadow-xl">
            <div class="p-6">
                <img src="https://api.builder.io/api/v1/image/assets/TEMP/2be35173d58f331ca7f66e5825c24c003f2f1cb3?width=475" 
                     alt="Heigen Logo" class="h-24 w-auto mx-auto mb-8">
            </div>

            <nav class="space-y-1 px-4">
                <a href="#" onclick="navigateTo('dashboard')" id="nav-dashboard"
                   class="${activePage === 'dashboard' ? 'sidebar-active' : ''} flex items-center gap-3 px-4 py-3 rounded-lg text-white font-bold text-sm hover:bg-[#2F4952] transition-colors">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 21.976C2.73478 21.976 2.48043 21.8706 2.29289 21.6831C2.10536 21.4956 2 21.2412 2 20.976V0H0V20.976C0 21.7716 0.31607 22.5347 0.87868 23.0973C1.44129 23.6599 2.20435 23.976 3 23.976H24V21.976H3Z"/>
                        <path d="M7 12H5V19H7V12Z"/>
                        <path d="M12 10H10V19H12V10Z"/>
                        <path d="M17 13H15V19H17V13Z"/>
                        <path d="M22 9H20V19H22V9Z"/>
                    </svg>
                    Dashboard
                </a>

                <a href="#" onclick="navigateTo('customers')" id="nav-customers"
                   class="${activePage === 'customers' ? 'sidebar-active' : ''} flex items-center gap-3 px-4 py-3 rounded-lg text-[#F6EFE3] font-bold text-sm hover:bg-[#2F4952] transition-colors">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4.5 17H4C3.44772 17 3 16.5523 3 16C3 14.3431 4.34315 13 6 13H7M7 9.94999C5.85888 9.71836 5 8.70948 5 7.5C5 6.11929 6.11929 5 7.5 5C8.06291 5 8.58237 5.18604 9.00024 5.5M19.5002 17H20.0002C20.5525 17 21.0002 16.5523 21.0002 16C21.0002 14.3431 19.6571 13 18.0002 13H17.0002M17.0002 9.94999C18.1414 9.71836 19.0002 8.70948 19.0002 7.5C19.0002 6.11929 17.881 5 16.5002 5C15.9373 5 15.4179 5.18604 15 5.5M15.5 19H8.5C7.94771 19 7.5 18.5523 7.5 18C7.5 16.3431 8.84314 15 10.5 15H13.5C15.1569 15 16.5 16.3431 16.5 18C16.5 18.5523 16.0523 19 15.5 19ZM14.5 9.5C14.5 10.8807 13.3807 12 12 12C10.6193 12 9.5 10.8807 9.5 9.5C9.5 8.11929 10.6193 7 12 7C13.3807 7 14.5 8.11929 14.5 9.5Z"/>
                    </svg>
                    Customer Data
                </a>

                <a href="#" onclick="navigateTo('packages')" id="nav-packages"
                   class="${activePage === 'packages' ? 'sidebar-active' : ''} flex items-center gap-3 px-4 py-3 rounded-lg text-[#F6EFE3] font-bold text-sm hover:bg-[#2F4952] transition-colors">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M15 4H18C18.5523 4 19 4.44772 19 5V20C19 20.5523 18.5523 21 18 21H6C5.44772 21 5 20.5523 5 20V5C5 4.44772 5.44772 4 6 4H9M9 7H15M9 12H15M9 16H15M10 3V7H14V3H10Z"/>
                    </svg>
                    Package List
                </a>

                <a href="#" class="flex items-center gap-3 px-4 py-3 rounded-lg text-[#F6EFE3] font-bold text-sm hover:bg-[#2F4952] transition-colors">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 5V4C18 3.44772 17.5523 3 17 3H8.91421C8.649 3 8.39464 3.10536 8.20711 3.29289L4.29289 7.20711C4.10536 7.39464 4 7.649 4 7.91421V20C4 20.5523 4.44772 21 5 21H17C17.5523 21 18 20.5523 18 20V15M9 3V7C9 7.55228 8.55228 8 8 8H4"/>
                    </svg>
                    Survey Form
                </a>

                <div class="border-t border-[#4F6E79] my-4"></div>

                <a href="#" class="flex items-center gap-3 px-4 py-3 rounded-lg text-[#F6EFE3] font-bold text-sm hover:bg-[#2F4952] transition-colors">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21ZM12 21C13.7608 21.0019 15.483 20.4843 16.951 19.512C16.835 18.5451 16.3691 17.6541 15.6412 17.0071C14.9133 16.3601 13.9739 16.0019 13 16H11C10.0261 16.0019 9.08665 16.3601 8.35879 17.0071C7.63092 17.6541 7.16502 18.5451 7.049 19.512C8.51698 20.4843 10.2392 21.0019 12 21ZM15 10C15 11.6569 13.6569 13 12 13C10.3431 13 9 11.6569 9 10C9 8.34315 10.3431 7 12 7C13.6569 7 15 8.34315 15 10Z"/>
                    </svg>
                    Profile
                </a>

                <a href="#" onclick="logout()" class="flex items-center gap-3 px-4 py-3 rounded-lg text-[#F6EFE3] font-bold text-sm hover:bg-[#2F4952] transition-colors">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9.35294 16.2001V18.3001C9.35294 18.8571 9.57605 19.3912 9.97319 19.785C10.3703 20.1788 10.909 20.4001 11.4706 20.4001L18.8824 20.4001C19.444 20.4001 19.9826 20.1788 20.3798 19.785C20.7769 19.3912 21 18.8571 21 18.3001L21 5.7001C21 5.14314 20.7769 4.609 20.3798 4.21517C19.9826 3.82135 19.444 3.6001 18.8824 3.6001L11.4706 3.6001C10.909 3.6001 10.3703 3.82135 9.97319 4.21517C9.57605 4.609 9.35294 5.14314 9.35294 5.7001V7.8001M15.7059 12.0001L3 12.0001M3 12.0001L6.17647 15.1501M3 12.0001L6.17647 8.8501"/>
                    </svg>
                    Logout
                </a>
            </nav>
        </div>
    `,

    // Header Component
    header: (title, userName, userRole) => `
        <div class="content-header h-24 flex items-center justify-between px-12">
            <h1 class="text-[#4F6E79] text-3xl font-bold font-[Montserrat]">${title}</h1>
            <div class="flex items-center gap-4">
                <div class="text-right">
                    <div class="text-[#4F6E79] text-lg font-bold">${userName}</div>
                    <div class="text-[#4F6E79] text-sm font-bold">${userRole}</div>
                </div>
                <img src="https://api.builder.io/api/v1/image/assets/TEMP/b01a800443ed9d93450cddf4ff40c133e70f3b0c?width=122" 
                     alt="Profile" class="w-16 h-16 rounded-full">
            </div>
        </div>
    `,

    // Search Bar Component
    searchBar: () => `
        <div class="flex items-center gap-2 bg-white rounded-full px-4 py-2 w-96 border border-[#4F6E79]">
            <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input type="text" id="search-input" placeholder="Search..." class="flex-1 outline-none text-sm">
            <svg class="w-5 h-5 text-[#165166] cursor-pointer" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/>
            </svg>
        </div>
    `,

    // Customer Row Component
    customerRow: (customer) => `
        <tr class="border-b hover:bg-gray-50">
            <td class="py-3">
                <input type="checkbox" class="rounded" data-customer-id="${customer.id}">
            </td>
            <td class="py-3 text-gray-700 text-sm">${customer.id}</td>
            <td class="py-3 text-gray-700 text-sm">${customer.name}</td>
            <td class="py-3 text-gray-700 text-sm">${customer.email}</td>
            <td class="py-3 text-gray-700 text-sm">${customer.contact}</td>
            <td class="py-3">
                <span class="px-3 py-1 rounded-full text-xs font-semibold ${customer.consent ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    ${customer.consent ? 'Yes' : 'No'}
                </span>
            </td>
            <td class="py-3 text-gray-700 text-sm">${customer.bookings || 0}</td>
            <td class="py-3">
                <button onclick="viewCustomer(${customer.id})" class="text-[#3D5C66] hover:text-[#2F4952] font-semibold text-sm">
                    View
                </button>
            </td>
        </tr>
    `,

    // Package Card Component
    packageCard: (pkg) => `
        <div class="package-card p-6 cursor-pointer" onclick="viewPackage(${pkg.id})">
            <h3 class="text-[#00445C] text-base font-bold mb-4">${pkg.name}</h3>
            <div class="bg-[#F5E6B3] h-40 rounded-lg mb-4 overflow-hidden">
                ${pkg.image ? `<img src="${pkg.image}" alt="${pkg.name}" class="w-full h-full object-cover">` : ''}
            </div>
            <p class="text-gray-600 text-sm mb-2">${pkg.description || ''}</p>
            <p class="text-[#3D5C66] text-lg font-bold">₱${pkg.price}</p>
        </div>
    `
};

// Load component into element
function loadComponent(elementId, html) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = html;
    }
}