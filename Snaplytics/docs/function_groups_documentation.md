# Function Groups Documentation

## Scope

- Projects: `backend` (Django), `electron-app` (Electron), `HeigenKiosk` (React Native)
- Grouping basis: purpose alignment across function names + file context
- Function set: user-defined named methods/functions

## Coverage Summary

- Total grouped functions: 373
- Total functional groups: 14

## 1. Package & Add-on Catalog CRUD

- Purpose: Functions that create/read/update/delete package and add-on catalog data.
- Functions in group: 95

### Included Functions

- `loadCategories` in `HeigenKiosk/package-api.js` (lines 17-36): Loads state or resources into memory/UI.
- `showToast` in `HeigenKiosk/package-api.js` (lines 62-82): Displays content or state to users.
- `renderCategories` in `HeigenKiosk/package-api.js` (lines 114-149): Builds UI output for display.
- `openCreateModal` in `HeigenKiosk/package-api.js` (lines 159-161): Creates new data or records.
- `apiFetch` in `HeigenKiosk/shared_package_data.js` (lines 9-28): Retrieves data from an API or service.
- `getPackages` in `HeigenKiosk/shared_package_data.js` (lines 32-34): Retrieves data for downstream use.
- `getPackagesByCategory` in `HeigenKiosk/shared_package_data.js` (lines 36-41): Retrieves data for downstream use.
- `createPackage` in `HeigenKiosk/shared_package_data.js` (lines 43-48): Creates new data or records.
- `updatePackage` in `HeigenKiosk/shared_package_data.js` (lines 50-55): Updates existing records or state.
- `deletePackage` in `HeigenKiosk/shared_package_data.js` (lines 57-59): Removes records or entities.
- `getAddons` in `HeigenKiosk/shared_package_data.js` (lines 63-65): Adds data into an existing structure.
- `getAddonsByCategory` in `HeigenKiosk/shared_package_data.js` (lines 67-78): Adds data into an existing structure.
- `createAddon` in `HeigenKiosk/shared_package_data.js` (lines 80-82): Creates new data or records.
- `updateAddon` in `HeigenKiosk/shared_package_data.js` (lines 84-89): Adds data into an existing structure.
- `deleteAddon` in `HeigenKiosk/shared_package_data.js` (lines 91-93): Adds data into an existing structure.
- `getCategories` in `HeigenKiosk/shared_package_data.js` (lines 97-110): Retrieves data for downstream use.
- `getCustomers` in `HeigenKiosk/shared_package_data.js` (lines 114-116): Retrieves data for downstream use.
- `getCustomer` in `HeigenKiosk/shared_package_data.js` (lines 118-120): Retrieves data for downstream use.
- `createCustomer` in `HeigenKiosk/shared_package_data.js` (lines 122-127): Creates new data or records.
- `updateCustomer` in `HeigenKiosk/shared_package_data.js` (lines 129-134): Updates existing records or state.
- `deleteCustomers` in `HeigenKiosk/shared_package_data.js` (lines 136-141): Removes records or entities.
- `getBookings` in `HeigenKiosk/shared_package_data.js` (lines 145-148): Retrieves data for downstream use.
- `getCustomerBookings` in `HeigenKiosk/shared_package_data.js` (lines 150-152): Retrieves data for downstream use.
- `createBooking` in `HeigenKiosk/shared_package_data.js` (lines 154-159): Creates new data or records.
- `getRecommendations` in `HeigenKiosk/shared_package_data.js` (lines 170-174): Retrieves data for downstream use.
- `refreshRecommender` in `HeigenKiosk/shared_package_data.js` (lines 183-199): Refreshes data/state to latest values.
- `AddonsScreen` in `HeigenKiosk/src/screens/AddonsScreen.js` (lines 11-477): Adds data into an existing structure.
- `AddonCard` in `HeigenKiosk/src/screens/AddonsScreen.js` (lines 480-599): Adds data into an existing structure.
- `PackageScreen` in `HeigenKiosk/src/screens/PackageScreen.js` (lines 12-158): Executes business logic for this feature area.
- `toStringArray` in `HeigenKiosk/src/screens/PackageScreen.js` (lines 160-165): Executes business logic for this feature area.
- `hasPromo` in `HeigenKiosk/src/screens/PackageScreen.js` (lines 166-168): Executes business logic for this feature area.
- `IncludeRow` in `HeigenKiosk/src/screens/PackageScreen.js` (lines 170-197): Executes business logic for this feature area.
- `PackageCard` in `HeigenKiosk/src/screens/PackageScreen.js` (lines 200-368): Executes business logic for this feature area.
- `getGuestContext` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 18-24): Retrieves data for downstream use.
- `ensureLoadingOverlay` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 35-46): Loads state or resources into memory/UI.
- `ensureToast` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 62-75): Executes business logic for this feature area.
- `showToast` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 77-87): Displays content or state to users.
- `showError` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 89-95): Displays content or state to users.
- `packagePrice` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 118-122): Executes business logic for this feature area.
- `setPackageOptions` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 124-136): Executes business logic for this feature area.
- `renderAddonRows` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 138-170): Adds data into an existing structure.
- `getSelectedAddons` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 172-178): Adds data into an existing structure.
- `loadData` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 180-197): Adds data into an existing structure.
- `getGuestContext` in `electron-app/pages/guest/js/bookingform_packagelist.js` (lines 10-16): Retrieves data for downstream use.
- `ensureLoadingOverlay` in `electron-app/pages/guest/js/bookingform_packagelist.js` (lines 45-56): Loads state or resources into memory/UI.
- `mergeCategories` in `electron-app/pages/guest/js/bookingform_packagelist.js` (lines 65-81): Executes business logic for this feature area.
- `sourceBadge` in `electron-app/pages/guest/js/bookingform_packagelist.js` (lines 107-111): Executes business logic for this feature area.
- `loadPageData` in `electron-app/pages/guest/js/bookingform_packagelist.js` (lines 168-196): Loads state or resources into memory/UI.
- `getGuestContext` in `electron-app/pages/guest/js/bookingform_packagelist2.js` (lines 13-19): Retrieves data for downstream use.
- `ensureLoadingOverlay` in `electron-app/pages/guest/js/bookingform_packagelist2.js` (lines 45-56): Loads state or resources into memory/UI.
- `renderPackages` in `electron-app/pages/guest/js/bookingform_packagelist2.js` (lines 65-103): Builds UI output for display.
- `loadPackages` in `electron-app/pages/guest/js/bookingform_packagelist2.js` (lines 105-129): Loads state or resources into memory/UI.
- `getFileTooLargeMessage` in `electron-app/scripts/package-api.js` (lines 29-31): Retrieves data for downstream use.
- `ensureUploadSize` in `electron-app/scripts/package-api.js` (lines 33-40): Loads state or resources into memory/UI.
- `fileToDataUrl` in `electron-app/scripts/package-api.js` (lines 42-49): Executes business logic for this feature area.
- `loadCategories` in `electron-app/scripts/package-api.js` (lines 51-92): Loads state or resources into memory/UI.
- `renderCategories` in `electron-app/scripts/package-api.js` (lines 117-153): Builds UI output for display.
- `openCreateModal` in `electron-app/scripts/package-api.js` (lines 155-161): Creates new data or records.
- `closeCreateModal` in `electron-app/scripts/package-api.js` (lines 163-165): Creates new data or records.
- `saveCreateCategory` in `electron-app/scripts/package-api.js` (lines 184-207): Creates new data or records.
- `saveEditCategory` in `electron-app/scripts/package-api.js` (lines 209-236): Modifies existing values.
- `deleteCategory` in `electron-app/scripts/package-api.js` (lines 238-270): Removes records or entities.
- `navigateToPackagesList` in `electron-app/scripts/package-api.js` (lines 272-274): Executes business logic for this feature area.
- `startPackagePage` in `electron-app/scripts/package-api.js` (lines 333-345): Executes business logic for this feature area.
- `ensureUploadSize` in `electron-app/scripts/package-list-api.js` (lines 46-53): Loads state or resources into memory/UI.
- `fileToDataUrl` in `electron-app/scripts/package-list-api.js` (lines 55-62): Executes business logic for this feature area.
- `formatPrice` in `electron-app/scripts/package-list-api.js` (lines 64-66): Executes business logic for this feature area.
- `toAmount` in `electron-app/scripts/package-list-api.js` (lines 68-76): Executes business logic for this feature area.
- `categoryImage` in `electron-app/scripts/package-list-api.js` (lines 78-98): Executes business logic for this feature area.
- `normalizePackage` in `electron-app/scripts/package-list-api.js` (lines 100-117): Executes business logic for this feature area.
- `normalizeAddon` in `electron-app/scripts/package-list-api.js` (lines 119-129): Adds data into an existing structure.
- `addonAppliesToCategory` in `electron-app/scripts/package-list-api.js` (lines 131-139): Adds data into an existing structure.
- `renderItems` in `electron-app/scripts/package-list-api.js` (lines 167-232): Builds UI output for display.
- `getInclusionValues` in `electron-app/scripts/package-list-api.js` (lines 234-239): Retrieves data for downstream use.
- `renderInclusionFields` in `electron-app/scripts/package-list-api.js` (lines 241-258): Builds UI output for display.
- `openCreateModal` in `electron-app/scripts/package-list-api.js` (lines 260-280): Creates new data or records.
- `closeCreateModal` in `electron-app/scripts/package-list-api.js` (lines 282-284): Creates new data or records.
- `saveCreateItem` in `electron-app/scripts/package-list-api.js` (lines 323-368): Creates new data or records.
- `saveEditItem` in `electron-app/scripts/package-list-api.js` (lines 370-413): Modifies existing values.
- `deleteItem` in `electron-app/scripts/package-list-api.js` (lines 415-431): Removes records or entities.
- `applySearchFilter` in `electron-app/scripts/package-list-api.js` (lines 433-437): Executes business logic for this feature area.
- `switchTab` in `electron-app/scripts/package-list-api.js` (lines 439-450): Executes business logic for this feature area.
- `addInclusionField` in `electron-app/scripts/package-list-api.js` (lines 452-456): Adds data into an existing structure.
- `addEditInclusionField` in `electron-app/scripts/package-list-api.js` (lines 458-462): Adds data into an existing structure.
- `removeInclusionField` in `electron-app/scripts/package-list-api.js` (lines 464-467): Removes existing data from a collection/store.
- `removeEditInclusionField` in `electron-app/scripts/package-list-api.js` (lines 469-472): Modifies existing values.
- `toggleMobileSidebar` in `electron-app/scripts/package-list-api.js` (lines 474-484): Executes business logic for this feature area.
- `goBackToPackages` in `electron-app/scripts/package-list-api.js` (lines 486-488): Executes business logic for this feature area.
- `confirmLogout` in `electron-app/scripts/package-list-api.js` (lines 501-503): Executes business logic for this feature area.
- `startListPage` in `electron-app/scripts/package-list-api.js` (lines 592-606): Executes business logic for this feature area.
- `fetchPackages` in `electron-app/scripts/shared_package_data.js` (lines 13-33): Retrieves data from an API or service.
- `fetchAddons` in `electron-app/scripts/shared_package_data.js` (lines 35-55): Adds data into an existing structure.
- `getCategories` in `electron-app/scripts/shared_package_data.js` (lines 59-69): Retrieves data for downstream use.
- `getPackagesByCategory` in `electron-app/scripts/shared_package_data.js` (lines 72-75): Retrieves data for downstream use.
- `getAddonsByCategory` in `electron-app/scripts/shared_package_data.js` (lines 78-102): Adds data into an existing structure.

## 2. Customer Management

- Purpose: Functions that capture and manage customer records and customer lookup operations.
- Functions in group: 79

### Included Functions

- `CustomerFormModal` in `HeigenKiosk/src/screens/CustomerFormModal.js` (lines 19-607): Executes business logic for this feature area.
- `set` in `HeigenKiosk/src/screens/CustomerFormModal.js` (lines 51-54): Executes business logic for this feature area.
- `validate` in `HeigenKiosk/src/screens/CustomerFormModal.js` (lines 56-64): Validates input or business rules.
- `inp` in `HeigenKiosk/src/screens/CustomerFormModal.js` (lines 83-92): Executes business logic for this feature area.
- `PhoneField` in `HeigenKiosk/src/screens/CustomerFormModal.js` (lines 609-639): Executes business logic for this feature area.
- `PhoneInput` in `HeigenKiosk/src/screens/CustomerFormModal.js` (lines 641-662): Executes business logic for this feature area.
- `normalizeConsent` in `electron-app/pages/guest/js/customer-info.js` (lines 30-32): Executes business logic for this feature area.
- `findCustomerByEmail` in `electron-app/pages/guest/js/customer-info.js` (lines 34-44): Executes business logic for this feature area.
- `upsertCustomer` in `electron-app/pages/guest/js/customer-info.js` (lines 46-59): Executes business logic for this feature area.
- `setSubmitState` in `electron-app/pages/guest/js/customer-info.js` (lines 61-67): Submits collected data to a destination.
- `ensureLoadingOverlay` in `electron-app/pages/guest/js/customer-info.js` (lines 69-80): Loads state or resources into memory/UI.
- `ensureToast` in `electron-app/pages/guest/js/customer-info.js` (lines 90-103): Executes business logic for this feature area.
- `showError` in `electron-app/pages/guest/js/customer-info.js` (lines 105-110): Displays content or state to users.
- `toggleMobileSidebar` in `electron-app/scripts/customer-api.js` (lines 3-14): Executes business logic for this feature area.
- `confirmLogout` in `electron-app/scripts/customer-api.js` (lines 70-73): Executes business logic for this feature area.
- `normalizeConsent` in `electron-app/scripts/customer-api.js` (lines 75-86): Executes business logic for this feature area.
- `normalizeConsent` in `electron-app/scripts/customer-data.js` (lines 21-33): Executes business logic for this feature area.
- `loadCustomers` in `electron-app/scripts/customer-data.js` (lines 37-54): Loads state or resources into memory/UI.
- `getFilteredAndSortedCustomers` in `electron-app/scripts/customer-data.js` (lines 58-99): Retrieves data for downstream use.
- `renderTable` in `electron-app/scripts/customer-data.js` (lines 103-170): Builds UI output for display.
- `renderPagination` in `electron-app/scripts/customer-data.js` (lines 195-210): Builds UI output for display.
- `handleSelectAll` in `electron-app/scripts/customer-data.js` (lines 214-230): Handles an event-driven interaction.
- `handleSelectRow` in `electron-app/scripts/customer-data.js` (lines 232-237): Handles an event-driven interaction.
- `handleSelectMode` in `electron-app/scripts/customer-data.js` (lines 239-243): Handles an event-driven interaction.
- `handleCancel` in `electron-app/scripts/customer-data.js` (lines 245-253): Handles an event-driven interaction.
- `handleSave` in `electron-app/scripts/customer-data.js` (lines 255-257): Handles an event-driven interaction.
- `navigateToCustomerDetails` in `electron-app/scripts/customer-data.js` (lines 259-261): Executes business logic for this feature area.
- `handleAddCustomer` in `electron-app/scripts/customer-data.js` (lines 265-269): Adds data into an existing structure.
- `handleEditCustomer` in `electron-app/scripts/customer-data.js` (lines 271-280): Modifies existing values.
- `renderCustomerModal` in `electron-app/scripts/customer-data.js` (lines 282-336): Builds UI output for display.
- `handleSaveCustomer` in `electron-app/scripts/customer-data.js` (lines 338-385): Handles an event-driven interaction.
- `closeCustomerModal` in `electron-app/scripts/customer-data.js` (lines 387-391): Closes a view, modal, or resource.
- `handleDeleteCustomer` in `electron-app/scripts/customer-data.js` (lines 395-414): Removes records or entities.
- `confirmDeleteCustomer` in `electron-app/scripts/customer-data.js` (lines 416-440): Removes records or entities.
- `cancelDeleteCustomer` in `electron-app/scripts/customer-data.js` (lines 442-445): Removes records or entities.
- `ensureRecommendationStyles` in `electron-app/scripts/customer-details.js` (lines 4-11): Executes business logic for this feature area.
- `normalizeConsent` in `electron-app/scripts/customer-details.js` (lines 15-27): Executes business logic for this feature area.
- `getParameterByName` in `electron-app/scripts/customer-details.js` (lines 44-49): Retrieves data for downstream use.
- `initializeCustomerDetails` in `electron-app/scripts/customer-details.js` (lines 51-91): Executes business logic for this feature area.
- `renderCustomerDetails` in `electron-app/scripts/customer-details.js` (lines 95-132): Builds UI output for display.
- `debugModelMetrics` in `electron-app/scripts/customer-details.js` (lines 236-243): Executes business logic for this feature area.
- `updateLoadingProgress` in `electron-app/scripts/customer-details.js` (lines 245-262): Loads state or resources into memory/UI.
- `updatePredictionProgress` in `electron-app/scripts/customer-details.js` (lines 264-281): Updates existing records or state.
- `loadRecommendations` in `electron-app/scripts/customer-details.js` (lines 282-300): Loads state or resources into memory/UI.
- `loadRenewalPrediction` in `electron-app/scripts/customer-details.js` (lines 302-318): Loads state or resources into memory/UI.
- `loadModelMetrics` in `electron-app/scripts/customer-details.js` (lines 320-379): Loads state or resources into memory/UI.
- `ensureModelMetricsLoaded` in `electron-app/scripts/customer-details.js` (lines 381-400): Loads state or resources into memory/UI.
- `updateVisibleMetricsInPlace` in `electron-app/scripts/customer-details.js` (lines 402-420): Updates existing records or state.
- `escapeHtml` in `electron-app/scripts/customer-details.js` (lines 430-437): Executes business logic for this feature area.
- `pct` in `electron-app/scripts/customer-details.js` (lines 439-442): Executes business logic for this feature area.
- `isRatioMetric` in `electron-app/scripts/customer-details.js` (lines 444-456): Executes business logic for this feature area.
- `formatMetricLabel` in `electron-app/scripts/customer-details.js` (lines 458-482): Executes business logic for this feature area.
- `formatMetricValue` in `electron-app/scripts/customer-details.js` (lines 484-490): Executes business logic for this feature area.
- `renderMetricsRows` in `electron-app/scripts/customer-details.js` (lines 492-507): Builds UI output for display.
- `renderRecommendationRowsTable` in `electron-app/scripts/customer-details.js` (lines 509-538): Builds UI output for display.
- `renderMetricsCollapsible` in `electron-app/scripts/customer-details.js` (lines 540-554): Builds UI output for display.
- `renderRenewalMetricsCollapsible` in `electron-app/scripts/customer-details.js` (lines 556-608): Builds UI output for display.
- `renderRecommendationMetricsCollapsible` in `electron-app/scripts/customer-details.js` (lines 610-706): Builds UI output for display.
- `getRenewalBadgeClass` in `electron-app/scripts/customer-details.js` (lines 708-712): Retrieves data for downstream use.
- `renderRenewalPanel` in `electron-app/scripts/customer-details.js` (lines 714-838): Builds UI output for display.
- `renderPanels` in `electron-app/scripts/customer-details.js` (lines 840-1024): Builds UI output for display.
- `getSourceBadge` in `electron-app/scripts/customer-details.js` (lines 1026-1041): Retrieves data for downstream use.
- `renderRecommendationPanel` in `electron-app/scripts/customer-details.js` (lines 1043-1271): Builds UI output for display.
- `handleBookPackage` in `electron-app/scripts/customer-details.js` (lines 1275-1334): Handles an event-driven interaction.
- `togglePredictView` in `electron-app/scripts/customer-details.js` (lines 1343-1348): Executes business logic for this feature area.
- `toggleRecommendationView` in `electron-app/scripts/customer-details.js` (lines 1350-1355): Executes business logic for this feature area.
- `refreshRenewalPanel` in `electron-app/scripts/customer-details.js` (lines 1357-1363): Refreshes data/state to latest values.
- `refreshRecommendationPanel` in `electron-app/scripts/customer-details.js` (lines 1365-1371): Refreshes data/state to latest values.
- `recomputeRecommendationEvaluation` in `electron-app/scripts/customer-details.js` (lines 1373-1403): Executes business logic for this feature area.
- `handleViewInvoice` in `electron-app/scripts/customer-details.js` (lines 1422-1432): Handles an event-driven interaction.
- `handlePackageSelect` in `electron-app/scripts/customer-details.js` (lines 1573-1580): Handles an event-driven interaction.
- `handleAddonChange` in `electron-app/scripts/customer-details.js` (lines 1582-1592): Adds data into an existing structure.
- `handleAddonQuantity` in `electron-app/scripts/customer-details.js` (lines 1594-1600): Adds data into an existing structure.
- `handleRemoveAddon` in `electron-app/scripts/customer-details.js` (lines 1602-1605): Adds data into an existing structure.
- `handleAddAddon` in `electron-app/scripts/customer-details.js` (lines 1607-1615): Adds data into an existing structure.
- `handlePackageInfoNext` in `electron-app/scripts/customer-details.js` (lines 1617-1655): Handles an event-driven interaction.
- `_todayString` in `electron-app/scripts/customer-details.js` (lines 1758-1761): Executes business logic for this feature area.
- `renderDeleteConfirmation` in `electron-app/scripts/customer-details.js` (lines 1991-2009): Removes records or entities.
- `downloadInvoicePDF` in `electron-app/scripts/customer-details.js` (lines 2013-2060): Loads state or resources into memory/UI.

## 3. App Lifecycle & Navigation

- Purpose: Functions that initialize app state and orchestrate navigation or session flow between pages/screens.
- Functions in group: 57

### Included Functions

- `createInitialState` in `HeigenKiosk/src/screens/KioskApp.js` (lines 31-47): Creates new data or records.
- `KioskApp` in `HeigenKiosk/src/screens/KioskApp.js` (lines 49-453): Executes business logic for this feature area.
- `reset` in `HeigenKiosk/src/screens/KioskApp.js` (lines 57-59): Resets state to defaults.
- `openExitPage` in `HeigenKiosk/src/screens/KioskApp.js` (lines 61-63): Opens a view, modal, or resource.
- `closeExitPage` in `HeigenKiosk/src/screens/KioskApp.js` (lines 65-67): Closes a view, modal, or resource.
- `confirmExitSession` in `HeigenKiosk/src/screens/KioskApp.js` (lines 69-74): Executes business logic for this feature area.
- `handleSelectCategory` in `HeigenKiosk/src/screens/KioskApp.js` (lines 76-78): Handles an event-driven interaction.
- `handleSelectPackage` in `HeigenKiosk/src/screens/KioskApp.js` (lines 79-81): Handles an event-driven interaction.
- `handleToggleAddon` in `HeigenKiosk/src/screens/KioskApp.js` (lines 82-92): Adds data into an existing structure.
- `handleBackToCategory` in `HeigenKiosk/src/screens/KioskApp.js` (lines 93-100): Handles an event-driven interaction.
- `handleBackToPackages` in `HeigenKiosk/src/screens/KioskApp.js` (lines 101-103): Handles an event-driven interaction.
- `handleProceedToBookNow` in `HeigenKiosk/src/screens/KioskApp.js` (lines 104-113): Handles an event-driven interaction.
- `handleCustomerFormSubmit` in `HeigenKiosk/src/screens/KioskApp.js` (lines 114-149): Handles an event-driven interaction.
- `handleEditSelection` in `HeigenKiosk/src/screens/KioskApp.js` (lines 150-152): Modifies existing values.
- `handleQuickBookRecommendation` in `HeigenKiosk/src/screens/KioskApp.js` (lines 154-166): Handles an event-driven interaction.
- `calcTotal` in `HeigenKiosk/src/screens/KioskApp.js` (lines 201-213): Executes business logic for this feature area.
- `BackendConfig.ready` in `backend/apps.py` (lines 8-9): Executes business logic for this feature area.
- `startDjango` in `electron-app/main.js` (lines 10-21): Executes business logic for this feature area.
- `createWindow` in `electron-app/main.js` (lines 23-36): Creates new data or records.
- `toggleMobileSidebar` in `electron-app/scripts/app.js` (lines 26-36): Executes business logic for this feature area.
- `navigateTo` in `electron-app/scripts/app.js` (lines 38-40): Executes business logic for this feature area.
- `openLogoutModal` in `electron-app/scripts/app.js` (lines 42-46): Opens a view, modal, or resource.
- `closeLogoutModal` in `electron-app/scripts/app.js` (lines 48-51): Closes a view, modal, or resource.
- `confirmLogout` in `electron-app/scripts/app.js` (lines 53-55): Executes business logic for this feature area.
- `isDateInRange` in `electron-app/scripts/app.js` (lines 58-84): Executes business logic for this feature area.
- `getFilteredAndSortedCustomers` in `electron-app/scripts/app.js` (lines 87-137): Retrieves data for downstream use.
- `navigateTo` in `electron-app/scripts/customer-api.js` (lines 16-58): Executes business logic for this feature area.
- `openLogoutModal` in `electron-app/scripts/customer-api.js` (lines 59-63): Opens a view, modal, or resource.
- `closeLogoutModal` in `electron-app/scripts/customer-api.js` (lines 65-68): Closes a view, modal, or resource.
- `resetModelMetrics` in `electron-app/scripts/customer-details.js` (lines 422-428): Resets state to defaults.
- `goBackToPackageInfo` in `electron-app/scripts/customer-details.js` (lines 1657-1659): Executes business logic for this feature area.
- `closePackageModal` in `electron-app/scripts/customer-details.js` (lines 1763-1769): Closes a view, modal, or resource.
- `closeBookingSummaryModal` in `electron-app/scripts/customer-details.js` (lines 1852-1854): Closes a view, modal, or resource.
- `closeInvoiceModal` in `electron-app/scripts/customer-details.js` (lines 1978-1981): Closes a view, modal, or resource.
- `getOnboardingFlag` in `electron-app/scripts/heigen-app.js` (lines 16-18): Retrieves data for downstream use.
- `setOnboardingFlag` in `electron-app/scripts/heigen-app.js` (lines 20-22): Executes business logic for this feature area.
- `isStaffAdminPage` in `electron-app/scripts/heigen-app.js` (lines 24-27): Executes business logic for this feature area.
- `isOnboardingPage` in `electron-app/scripts/heigen-app.js` (lines 29-32): Executes business logic for this feature area.
- `enforceOnboarding` in `electron-app/scripts/heigen-app.js` (lines 34-41): Executes business logic for this feature area.
- `navigateTo` in `electron-app/scripts/heigen-app.js` (lines 47-49): Executes business logic for this feature area.
- `getSignInPagePath` in `electron-app/scripts/heigen-app.js` (lines 51-56): Retrieves data for downstream use.
- `logLoginDebugSnapshot` in `electron-app/scripts/heigen-app.js` (lines 58-180): Executes business logic for this feature area.
- `normalizeLoginPageState` in `electron-app/scripts/heigen-app.js` (lines 182-229): Executes business logic for this feature area.
- `showToast` in `electron-app/scripts/heigen-app.js` (lines 235-250): Displays content or state to users.
- `showSuccessModal` in `electron-app/scripts/heigen-app.js` (lines 256-264): Displays content or state to users.
- `closeModal` in `electron-app/scripts/heigen-app.js` (lines 266-273): Closes a view, modal, or resource.
- `logout` in `electron-app/scripts/heigen-app.js` (lines 369-382): Executes business logic for this feature area.
- `handleStartBooking` in `electron-app/scripts/notif.js` (lines 127-137): Handles an event-driven interaction.
- `getInitials` in `electron-app/scripts/onboarding.js` (lines 103-107): Retrieves data for downstream use.
- `updateInitials` in `electron-app/scripts/onboarding.js` (lines 154-158): Updates existing records or state.
- `openEditModal` in `electron-app/scripts/package-api.js` (lines 167-176): Modifies existing values.
- `closeEditModal` in `electron-app/scripts/package-api.js` (lines 178-182): Modifies existing values.
- `initializeData` in `electron-app/scripts/package-list-api.js` (lines 141-165): Executes business logic for this feature area.
- `openEditModal` in `electron-app/scripts/package-list-api.js` (lines 286-316): Modifies existing values.
- `closeEditModal` in `electron-app/scripts/package-list-api.js` (lines 318-321): Modifies existing values.
- `openLogoutModal` in `electron-app/scripts/package-list-api.js` (lines 490-494): Opens a view, modal, or resource.
- `closeLogoutModal` in `electron-app/scripts/package-list-api.js` (lines 496-499): Closes a view, modal, or resource.

## 4. Booking Workflow

- Purpose: Functions that build, submit, queue, and update booking transactions.
- Functions in group: 49

### Included Functions

- `updateBookingStatus` in `HeigenKiosk/shared_package_data.js` (lines 161-166): Updates existing records or state.
- `submitBooking` in `HeigenKiosk/src/api/client.js` (lines 176-205): Submits collected data to a destination.
- `fetchBookingsByStatus` in `HeigenKiosk/src/api/client.js` (lines 208-210): Retrieves data from an API or service.
- `updateBookingStatus` in `HeigenKiosk/src/api/client.js` (lines 212-217): Updates existing records or state.
- `normalizeKey` in `HeigenKiosk/src/constants/assets.js` (lines 33-35): Executes business logic for this feature area.
- `resolveCategoryImage` in `HeigenKiosk/src/constants/assets.js` (lines 37-43): Executes business logic for this feature area.
- `resolvePackageImage` in `HeigenKiosk/src/constants/assets.js` (lines 45-51): Executes business logic for this feature area.
- `useMutation` in `HeigenKiosk/src/hooks/useApi.js` (lines 50-70): Executes business logic for this feature area.
- `useScale` in `HeigenKiosk/src/hooks/useScale.js` (lines 18-35): Executes business logic for this feature area.
- `s` in `HeigenKiosk/src/hooks/useScale.js` (lines 29-29): Executes business logic for this feature area.
- `fs` in `HeigenKiosk/src/hooks/useScale.js` (lines 32-32): Executes business logic for this feature area.
- `AdminBookingQueue` in `HeigenKiosk/src/screens/AdminBookingQueue.js` (lines 28-161): Executes business logic for this feature area.
- `handleRefresh` in `HeigenKiosk/src/screens/AdminBookingQueue.js` (lines 40-44): Handles an event-driven interaction.
- `handleStatusChange` in `HeigenKiosk/src/screens/AdminBookingQueue.js` (lines 46-68): Handles an event-driven interaction.
- `handleRefreshRecommender` in `HeigenKiosk/src/screens/AdminBookingQueue.js` (lines 70-90): Handles an event-driven interaction.
- `BookingCard` in `HeigenKiosk/src/screens/AdminBookingQueue.js` (lines 163-193): Executes business logic for this feature area.
- `BookingDetailModal` in `HeigenKiosk/src/screens/AdminBookingQueue.js` (lines 195-270): Executes business logic for this feature area.
- `Section` in `HeigenKiosk/src/screens/AdminBookingQueue.js` (lines 272-279): Executes business logic for this feature area.
- `DetailRow` in `HeigenKiosk/src/screens/AdminBookingQueue.js` (lines 281-288): Executes business logic for this feature area.
- `BookingSummaryModal` in `HeigenKiosk/src/screens/BookingSummaryModal.js` (lines 16-757): Executes business logic for this feature area.
- `SRow` in `HeigenKiosk/src/screens/BookingSummaryModal.js` (lines 759-780): Executes business logic for this feature area.
- `PhoneRow` in `HeigenKiosk/src/screens/BookingSummaryModal.js` (lines 781-802): Executes business logic for this feature area.
- `ConfirmationScreen` in `HeigenKiosk/src/screens/ConfirmationScreen.js` (lines 7-77): Executes business logic for this feature area.
- `handleSubmit` in `HeigenKiosk/src/screens/CustomerFormModal.js` (lines 66-75): Handles an event-driven interaction.
- `handleConfirmBooking` in `HeigenKiosk/src/screens/KioskApp.js` (lines 168-199): Handles an event-driven interaction.
- `renderBookingHistory` in `electron-app/scripts/customer-details.js` (lines 136-210): Builds UI output for display.
- `toggleBookingHistory` in `electron-app/scripts/customer-details.js` (lines 1338-1341): Executes business logic for this feature area.
- `handleAddBooking` in `electron-app/scripts/customer-details.js` (lines 1407-1411): Adds data into an existing structure.
- `handleEditBooking` in `electron-app/scripts/customer-details.js` (lines 1413-1420): Modifies existing values.
- `handleDeleteBooking` in `electron-app/scripts/customer-details.js` (lines 1434-1439): Removes records or entities.
- `confirmDeleteBooking` in `electron-app/scripts/customer-details.js` (lines 1441-1467): Removes records or entities.
- `cancelDeleteBooking` in `electron-app/scripts/customer-details.js` (lines 1469-1472): Removes records or entities.
- `confirmBookingSummary` in `electron-app/scripts/customer-details.js` (lines 1661-1731): Executes business logic for this feature area.
- `_mergeBookingDisplay` in `electron-app/scripts/customer-details.js` (lines 1738-1756): Executes business logic for this feature area.
- `renderBookingSummaryModal` in `electron-app/scripts/customer-details.js` (lines 1773-1850): Builds UI output for display.
- `handleEditBookingFromInvoice` in `electron-app/scripts/customer-details.js` (lines 1983-1987): Modifies existing values.
- `getCustomerBookings` in `electron-app/scripts/heigen-api.js` (lines 157-159): Retrieves data for downstream use.
- `toggleBookingStatusPanel` in `electron-app/scripts/notif.js` (lines 11-21): Executes business logic for this feature area.
- `closeBookingStatusPanel` in `electron-app/scripts/notif.js` (lines 23-29): Closes a view, modal, or resource.
- `loadPendingBookings` in `electron-app/scripts/notif.js` (lines 33-55): Loads state or resources into memory/UI.
- `renderBookingItems` in `electron-app/scripts/notif.js` (lines 69-123): Builds UI output for display.
- `handleDoneBooking` in `electron-app/scripts/notif.js` (lines 139-149): Handles an event-driven interaction.
- `handleDenyBooking` in `electron-app/scripts/notif.js` (lines 151-162): Handles an event-driven interaction.
- `handleCancelBooking` in `electron-app/scripts/notif.js` (lines 164-175): Handles an event-driven interaction.
- `handleViewBookingSummary` in `electron-app/scripts/notif.js` (lines 177-318): Handles an event-driven interaction.
- `bookings` in `electron-app/scripts/supabase-client.js` (lines 111-184): Executes business logic for this feature area.
- `bookingAddons` in `electron-app/scripts/supabase-client.js` (lines 190-253): Adds data into an existing structure.
- `transformBooking` in `electron-app/scripts/supabase-client.js` (lines 306-352): Executes business logic for this feature area.
- `bookingToDatabase` in `electron-app/scripts/supabase-client.js` (lines 387-414): Executes business logic for this feature area.

## 5. API & HTTP Client Utilities

- Purpose: Functions that encapsulate API requests, pagination, error handling, and transport-level concerns.
- Functions in group: 24

### Included Functions

- `apiRequest` in `HeigenKiosk/src/api/client.js` (lines 5-23): Executes business logic for this feature area.
- `fetchAllPages` in `HeigenKiosk/src/api/client.js` (lines 32-53): Retrieves data from an API or service.
- `fetchPackages` in `HeigenKiosk/src/api/client.js` (lines 56-61): Retrieves data from an API or service.
- `fetchCategories` in `HeigenKiosk/src/api/client.js` (lines 63-87): Retrieves data from an API or service.
- `fetchAddons` in `HeigenKiosk/src/api/client.js` (lines 90-101): Adds data into an existing structure.
- `fetchPopularPackage` in `HeigenKiosk/src/api/client.js` (lines 104-125): Retrieves data from an API or service.
- `fetchPopularAddons` in `HeigenKiosk/src/api/client.js` (lines 127-149): Adds data into an existing structure.
- `findCustomerByEmail` in `HeigenKiosk/src/api/client.js` (lines 152-161): Executes business logic for this feature area.
- `createCustomer` in `HeigenKiosk/src/api/client.js` (lines 163-173): Creates new data or records.
- `fetchRecommendations` in `HeigenKiosk/src/api/client.js` (lines 220-226): Retrieves data from an API or service.
- `fetchPopularRecommendations` in `HeigenKiosk/src/api/client.js` (lines 228-230): Retrieves data from an API or service.
- `useApi` in `HeigenKiosk/src/hooks/useApi.js` (lines 10-47): Executes business logic for this feature area.
- `recompute_customer_renewal_profile` in `backend/renewal_utils.py` (lines 10-91): Executes business logic for this feature area.
- `apiRequest` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 97-116): Executes business logic for this feature area.
- `apiRequest` in `electron-app/pages/guest/js/bookingform_packagelist.js` (lines 24-43): Executes business logic for this feature area.
- `apiRequest` in `electron-app/pages/guest/js/bookingform_packagelist2.js` (lines 25-43): Executes business logic for this feature area.
- `apiRequest` in `electron-app/pages/guest/js/customer-info.js` (lines 9-28): Executes business logic for this feature area.
- `_request` in `electron-app/scripts/api-client.js` (lines 9-29): Executes business logic for this feature area.
- `_unwrap` in `electron-app/scripts/api-client.js` (lines 32-37): Executes business logic for this feature area.
- `getCustomers` in `electron-app/scripts/heigen-api.js` (lines 153-155): Retrieves data for downstream use.
- `mockDelay` in `electron-app/scripts/heigen-api.js` (lines 351-352): Executes business logic for this feature area.
- `request` in `electron-app/scripts/package-api.js` (lines 12-27): Executes business logic for this feature area.
- `apiRequest` in `electron-app/scripts/package-list-api.js` (lines 29-44): Executes business logic for this feature area.
- `request` in `electron-app/scripts/supabase-client.js` (lines 17-65): Executes business logic for this feature area.

## 6. UI Components & Rendering

- Purpose: Functions that render reusable UI blocks and component-level presentation behavior.
- Functions in group: 21

### Included Functions

- `Icon` in `HeigenKiosk/src/components/Icon.js` (lines 64-89): Executes business logic for this feature area.
- `Button` in `HeigenKiosk/src/components/ui.js` (lines 22-111): Executes business logic for this feature area.
- `Card` in `HeigenKiosk/src/components/ui.js` (lines 114-150): Executes business logic for this feature area.
- `AccentCard` in `HeigenKiosk/src/components/ui.js` (lines 153-179): Executes business logic for this feature area.
- `Badge` in `HeigenKiosk/src/components/ui.js` (lines 182-223): Executes business logic for this feature area.
- `SectionHeader` in `HeigenKiosk/src/components/ui.js` (lines 226-267): Executes business logic for this feature area.
- `LoadingScreen` in `HeigenKiosk/src/components/ui.js` (lines 270-294): Loads state or resources into memory/UI.
- `ErrorScreen` in `HeigenKiosk/src/components/ui.js` (lines 297-339): Executes business logic for this feature area.
- `ModalSheet` in `HeigenKiosk/src/components/ui.js` (lines 342-421): Executes business logic for this feature area.
- `StepIndicator` in `HeigenKiosk/src/components/ui.js` (lines 425-572): Executes business logic for this feature area.
- `FormInput` in `HeigenKiosk/src/components/ui.js` (lines 575-615): Executes business logic for this feature area.
- `Divider` in `HeigenKiosk/src/components/ui.js` (lines 618-622): Executes business logic for this feature area.
- `renderGrid` in `HeigenKiosk/src/screens/AddonsScreen.js` (lines 70-95): Builds UI output for display.
- `RecommendationCard` in `HeigenKiosk/src/screens/CategoryScreen.js` (lines 155-218): Executes business logic for this feature area.
- `renderCategoryCards` in `electron-app/pages/guest/js/bookingform_packagelist.js` (lines 83-105): Builds UI output for display.
- `renderRecommendationCards` in `electron-app/pages/guest/js/bookingform_packagelist.js` (lines 113-166): Builds UI output for display.
- `loadComponent` in `electron-app/scripts/components.js` (lines 133-138): Loads state or resources into memory/UI.
- `renderActionButtons` in `electron-app/scripts/customer-data.js` (lines 172-193): Builds UI output for display.
- `renderViewButtons` in `electron-app/scripts/customer-details.js` (lines 214-220): Builds UI output for display.
- `renderPackageInfoModal` in `electron-app/scripts/customer-details.js` (lines 1476-1571): Builds UI output for display.
- `renderInvoiceModal` in `electron-app/scripts/customer-details.js` (lines 1858-1976): Builds UI output for display.

## 7. Authentication & Access Control

- Purpose: Functions that create, validate, and protect authenticated sessions and account access.
- Functions in group: 9

### Included Functions

- `issue_staff_temporary_password` in `backend/auth_utils.py` (lines 8-56): Executes business logic for this feature area.
- `PasswordResetRequest.__str__` in `backend/models.py` (lines 170-171): Resets state to defaults.
- `constructor` in `electron-app/scripts/supabase-client.js` (lines 11-14): Executes business logic for this feature area.
- `customers` in `electron-app/scripts/supabase-client.js` (lines 71-105): Executes business logic for this feature area.
- `packages` in `electron-app/scripts/supabase-client.js` (lines 259-266): Executes business logic for this feature area.
- `addons` in `electron-app/scripts/supabase-client.js` (lines 272-279): Adds data into an existing structure.
- `transformCustomer` in `electron-app/scripts/supabase-client.js` (lines 286-303): Executes business logic for this feature area.
- `transformAddon` in `electron-app/scripts/supabase-client.js` (lines 355-366): Adds data into an existing structure.
- `customerToDatabase` in `electron-app/scripts/supabase-client.js` (lines 369-384): Executes business logic for this feature area.

## 8. Django Models, Signals & Admin

- Purpose: Functions that define backend data model behavior, admin registration, and signal-driven side effects.
- Functions in group: 9

### Included Functions

- `UserCreationNoPasswordForm.save` in `backend/admin.py` (lines 36-41): Executes business logic for this feature area.
- `UserAdmin.save_model` in `backend/admin.py` (lines 66-76): Executes business logic for this feature area.
- `PasswordResetRequestAdmin._can_review` in `backend/admin.py` (lines 104-105): Resets state to defaults.
- `PasswordResetRequestAdmin.approve_requests` in `backend/admin.py` (lines 108-139): Resets state to defaults.
- `PasswordResetRequestAdmin.reject_requests` in `backend/admin.py` (lines 142-156): Resets state to defaults.
- `Category.__str__` in `backend/models.py` (lines 14-15): Executes business logic for this feature area.
- `Package.__str__` in `backend/models.py` (lines 33-34): Executes business logic for this feature area.
- `Customer.__str__` in `backend/models.py` (lines 52-53): Executes business logic for this feature area.
- `Addon.__str__` in `backend/models.py` (lines 65-66): Adds data into an existing structure.

## 9. Profile & Staff Management

- Purpose: Functions that load, edit, and persist profile or staff-specific information.
- Functions in group: 9

### Included Functions

- `StaffProfile.__str__` in `backend/models.py` (lines 132-133): Executes business logic for this feature area.
- `ensure_staff_profile` in `backend/signals.py` (lines 11-15): Executes business logic for this feature area.
- `setPhotoStatus` in `electron-app/scripts/profile-page.js` (lines 32-35): Executes business logic for this feature area.
- `buildFallbackAvatar` in `electron-app/scripts/profile-page.js` (lines 37-51): Executes business logic for this feature area.
- `applyProfile` in `electron-app/scripts/profile-page.js` (lines 53-90): Executes business logic for this feature area.
- `refreshProfile` in `electron-app/scripts/profile-page.js` (lines 92-103): Refreshes data/state to latest values.
- `getInitials` in `electron-app/scripts/staff-profile.js` (lines 13-19): Retrieves data for downstream use.
- `buildFallbackAvatar` in `electron-app/scripts/staff-profile.js` (lines 21-29): Executes business logic for this feature area.
- `applyProfile` in `electron-app/scripts/staff-profile.js` (lines 31-53): Executes business logic for this feature area.

## 10. Authenticated User Creation

- Purpose: Functions that register users and initialize user data during sign-up or onboarding.
- Functions in group: 6

### Included Functions

- `setError` in `electron-app/scripts/onboarding.js` (lines 33-42): Executes business logic for this feature area.
- `updateStepDots` in `electron-app/scripts/onboarding.js` (lines 44-56): Updates existing records or state.
- `showStep` in `electron-app/scripts/onboarding.js` (lines 58-78): Displays content or state to users.
- `setPasswordOnlyUI` in `electron-app/scripts/onboarding.js` (lines 80-101): Executes business logic for this feature area.
- `updatePhotoPreviewFromUrl` in `electron-app/scripts/onboarding.js` (lines 109-120): Updates existing records or state.
- `submitPasswordOnly` in `electron-app/scripts/onboarding.js` (lines 171-201): Submits collected data to a destination.

## 11. ETL & Data Operations

- Purpose: Functions that extract, transform, load, or move operational data between systems.
- Functions in group: 6

### Included Functions

- `Command.add_arguments` in `backend/management/commands/run_etl.py` (lines 7-8): Adds data into an existing structure.
- `Command.handle` in `backend/management/commands/run_etl.py` (lines 10-13): Handles an event-driven interaction.
- `setLoading` in `electron-app/pages/guest/js/bookingform_packageinfo.js` (lines 48-59): Loads state or resources into memory/UI.
- `setLoading` in `electron-app/pages/guest/js/bookingform_packagelist.js` (lines 57-62): Loads state or resources into memory/UI.
- `setLoading` in `electron-app/pages/guest/js/bookingform_packagelist2.js` (lines 57-62): Loads state or resources into memory/UI.
- `setLoading` in `electron-app/pages/guest/js/customer-info.js` (lines 82-87): Loads state or resources into memory/UI.

## 12. Notifications

- Purpose: Functions that prepare or dispatch notification messages/events.
- Functions in group: 5

### Included Functions

- `updateNotificationBadge` in `electron-app/scripts/notif.js` (lines 57-65): Updates existing records or state.
- `field` in `electron-app/scripts/notif.js` (lines 218-223): Executes business logic for this feature area.
- `closeNotifSummary` in `electron-app/scripts/notif.js` (lines 320-323): Closes a view, modal, or resource.
- `_setItemLoading` in `electron-app/scripts/notif.js` (lines 325-332): Loads state or resources into memory/UI.
- `refreshPage` in `electron-app/scripts/notif.js` (lines 336-356): Refreshes data/state to latest values.

## 13. Category Management

- Purpose: Functions that retrieve and maintain category structure used by packages and add-ons.
- Functions in group: 2

### Included Functions

- `CategoryScreen` in `HeigenKiosk/src/screens/CategoryScreen.js` (lines 21-153): Executes business logic for this feature area.
- `CategoryCard` in `HeigenKiosk/src/screens/CategoryScreen.js` (lines 220-260): Executes business logic for this feature area.

## 14. Recommendations & Personalization

- Purpose: Functions that fetch or compute recommendation and popularity outputs.
- Functions in group: 2

### Included Functions

- `getCustomerRecommendations` in `electron-app/scripts/recommendations.js` (lines 12-49): Retrieves data for downstream use.
- `formatPrice` in `electron-app/scripts/recommendations.js` (lines 56-58): Executes business logic for this feature area.
