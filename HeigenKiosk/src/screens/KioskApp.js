// src/screens/KioskApp.js
import React, { useState, useCallback, useEffect } from "react";
import {
    View,
    Text,
    SafeAreaView,
    Alert,
    TouchableOpacity,
} from "react-native";
import { StatusBar } from "expo-status-bar";

import { StepIndicator } from "../components/ui";
import Icon from "../components/Icon";
import CategoryScreen from "./CategoryScreen";
import PackageScreen from "./PackageScreen";
import AddonsScreen from "./AddonsScreen";
import ConfirmationScreen from "./ConfirmationScreen";
import CustomerFormModal from "./CustomerFormModal";
import BookingSummaryModal from "./BookingSummaryModal";

import {
    findCustomerByEmail,
    fetchPopularRecommendations,
    fetchRecommendations,
    fetchCustomerCoupons,
    loadKioskBootstrap,
    buildClientPopularRecommendations,
    submitBooking,
} from "../api/client";
import {
    colors,
    spacing,
    shadow,
    radii,
    atmosphere,
} from "../constants/theme";
import { useScale } from "../hooks/useScale";
import { LoadingScreen, ErrorScreen } from "../components/ui";

// Three main-flow steps only; final confirmation happens in BookingSummaryModal,
// then ConfirmationScreen (step 3) runs without the header.
const STEPS = ["Category", "Package", "Add-ons"];

function createInitialState() {
    return {
        step: 0,
        selectedCategory: null,
        selectedPackage: null,
        selectedAddons: [],
        customerInfo: null,
        customerId: null,
        availableCoupons: [],
        selectedCoupon: null,
        couponDiscount: 0,
        showCustomerForm: true,
        showSummary: false,
        showExitPage: false,
        requestSummaryAfterCustomerForm: false,
        loadingCustomerCheck: false,
        recommendationData: null,
        formResetToken: 0,
        submitting: false,
    };
}

export default function KioskApp() {
    const [state, setState] = useState(createInitialState());
    const [bootstrap, setBootstrap] = useState({
        status: "loading",
        snapshot: null,
        error: null,
    });
    const [bootRetryKey, setBootRetryKey] = useState(0);
    const { s, fs, isTablet } = useScale();

    useEffect(() => {
        let cancelled = false;
        setBootstrap({ status: "loading", snapshot: null, error: null });
        loadKioskBootstrap({ force: bootRetryKey > 0 })
            .then((snapshot) => {
                if (!cancelled) {
                    setBootstrap({ status: "ready", snapshot, error: null });
                }
            })
            .catch((e) => {
                if (!cancelled) {
                    setBootstrap({
                        status: "error",
                        snapshot: null,
                        error: e?.message || "Could not load kiosk data.",
                    });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [bootRetryKey]);

    const update = useCallback(
        (patch) => setState((prev) => ({ ...prev, ...patch })),
        [],
    );
    function reset() {
        setState(createInitialState());
    }

    function openExitPage() {
        update({ showExitPage: true });
    }

    function closeExitPage() {
        update({ showExitPage: false });
    }

    function confirmExitSession() {
        setState({
            ...createInitialState(),
            formResetToken: state.formResetToken + 1,
        });
    }

    function handleSelectCategory(cat) {
        update({ selectedCategory: cat, step: 1 });
    }
    function handleSelectPackage(pkg) {
        update({ selectedPackage: pkg, selectedAddons: [], step: 2 });
    }
    function handleToggleAddon(addon) {
        setState((prev) => {
            const already = prev.selectedAddons.some((a) => a.id === addon.id);
            return {
                ...prev,
                selectedAddons: already
                    ? prev.selectedAddons.filter((a) => a.id !== addon.id)
                    : [...prev.selectedAddons, addon],
            };
        });
    }
    function handleBackToCategory() {
        update({
            step: 0,
            selectedCategory: null,
            selectedPackage: null,
            selectedAddons: [],
        });
    }
    function handleBackToPackages() {
        update({ step: 1, selectedAddons: [] });
    }
    function handleProceedToBookNow() {
        if (state.customerInfo) {
            update({ showSummary: true });
            return;
        }
        update({
            showCustomerForm: true,
            requestSummaryAfterCustomerForm: true,
        });
    }
    async function handleCustomerFormSubmit(info) {
        update({
            loadingCustomerCheck: true,
            customerInfo: info,
        });

        const snap = bootstrap.snapshot;
        let recommendationData = null;
        let customerId = null;
        let availableCoupons = [];
        try {
            const existingCustomer = await findCustomerByEmail(info.email);
            if (existingCustomer) {
                customerId = existingCustomer.id || existingCustomer.customer_id;
                recommendationData = await fetchRecommendations(
                    customerId,
                    info.preferredDate || null,
                    3,
                );
                try {
                    availableCoupons = await fetchCustomerCoupons(customerId);
                } catch (_) {
                    availableCoupons = [];
                }
            } else {
                recommendationData = buildClientPopularRecommendations(snap, 3);
                if (!recommendationData?.recommendations?.length) {
                    try {
                        recommendationData = await fetchPopularRecommendations(3);
                    } catch (_) {
                        recommendationData = {
                            recommendations: [],
                            total_bookings: snap?.bookings?.length ?? 0,
                        };
                    }
                }
            }
        } catch (_) {
            try {
                recommendationData = buildClientPopularRecommendations(
                    bootstrap.snapshot,
                    3,
                );
                if (!recommendationData?.recommendations?.length) {
                    recommendationData = await fetchPopularRecommendations(3);
                }
            } catch (__) {
                recommendationData = { recommendations: [], total_bookings: 0 };
            }
        }

        update({
            customerId,
            recommendationData,
            availableCoupons,
            selectedCoupon: null,
            couponDiscount: 0,
            showCustomerForm: false,
            showSummary: state.requestSummaryAfterCustomerForm,
            requestSummaryAfterCustomerForm: false,
            loadingCustomerCheck: false,
        });
    }
    function handleEditSelection() {
        update({ showSummary: false });
    }

    function handleQuickBookRecommendation(rec) {
        const pkg = rec?.package;
        if (!pkg?.id) return;
        update({
            selectedCategory: {
                id: pkg.category || pkg.id,
                name: pkg.category || "Recommended",
            },
            selectedPackage: pkg,
            selectedAddons: Array.isArray(rec.addons) ? rec.addons : [],
            showSummary: true,
        });
    }

    async function handleConfirmBooking() {
        update({ submitting: true });
        try {
            const totalAmount = calcTotal() - (state.couponDiscount || 0);
            await submitBooking({
                customer: {
                    full_name: state.customerInfo.fullName,
                    email: state.customerInfo.email,
                    contact_number: state.customerInfo.contactNumber,
                    consent_given: state.customerInfo.consentGiven ?? true,
                },
                category_id:
                    state.selectedCategory?.id ?? state.selectedCategory?.name,
                package_id: state.selectedPackage?.id,
                addon_ids: state.selectedAddons.map((a) => a.id),
                preferred_date: state.customerInfo.preferredDate,
                total_amount: totalAmount,
                coupon_id: state.selectedCoupon?.id ?? null,
                customer_id: state.customerId,
            });
            update({
                submitting: false,
                showSummary: false,
                step: 3,
                formResetToken: state.formResetToken + 1,
            });
        } catch (err) {
            update({ submitting: false });
            Alert.alert(
                "Booking Failed",
                err.message || "Could not submit booking.",
                [{ text: "OK" }],
            );
        }
    }

    function calcTotal() {
        const base = Number(
            state.selectedPackage?.promo_price
                ? state.selectedPackage.promo_price
                : state.selectedPackage?.price
                  ? state.selectedPackage.price
                  : 0,
        );
        return (
            base +
            state.selectedAddons.reduce((sum, a) => sum + Number(a.price), 0)
        );
    }

    if (bootstrap.status === "loading") {
        return (
            <SafeAreaView
                style={{ flex: 1, backgroundColor: colors.background }}
            >
                <StatusBar style="dark" />
                <LoadingScreen message="Loading studio data…" />
            </SafeAreaView>
        );
    }

    if (bootstrap.status === "error") {
        return (
            <SafeAreaView
                style={{ flex: 1, backgroundColor: colors.background }}
            >
                <StatusBar style="dark" />
                <ErrorScreen
                    message={bootstrap.error}
                    onRetry={() => setBootRetryKey((k) => k + 1)}
                />
            </SafeAreaView>
        );
    }

    const kioskSnapshot = bootstrap.snapshot;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            <StatusBar style="dark" />
            {state.step < 3 &&
                (isTablet ? (
                    <View
                        style={{
                            backgroundColor: colors.backgroundElevated,
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                            paddingHorizontal: s(18),
                            paddingTop: s(6),
                            paddingBottom: s(10),
                            borderBottomLeftRadius: s(14),
                            borderBottomRightRadius: s(14),
                            overflow: "hidden",
                            ...shadow.sm,
                        }}
                    >
                        <View
                            style={{
                                height: s(3),
                                backgroundColor: colors.headerBar,
                                marginHorizontal: -s(18),
                                marginTop: -s(6),
                                marginBottom: s(8),
                            }}
                        />
                        <View
                            style={{
                                position: "relative",
                                flexDirection: "row",
                                alignItems: "center",
                                minHeight: s(38),
                            }}
                        >
                            <View
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    zIndex: 1,
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: fs(13),
                                        fontWeight: "800",
                                        color: colors.primary,
                                        letterSpacing: 0.85,
                                        textTransform: "uppercase",
                                    }}
                                    allowFontScaling={false}
                                    numberOfLines={1}
                                >
                                    Heigen Studio
                                </Text>
                                <Text
                                    style={{
                                        fontSize: fs(10),
                                        color: colors.mutedForeground,
                                        marginTop: s(1),
                                        fontWeight: "500",
                                    }}
                                    allowFontScaling={false}
                                    numberOfLines={1}
                                >
                                    Self-service booking
                                </Text>
                            </View>
                            <View
                                style={{
                                    position: "absolute",
                                    left: 0,
                                    right: 0,
                                    top: 0,
                                    bottom: 0,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    pointerEvents: "none",
                                }}
                            >
                                <View
                                    style={{
                                        backgroundColor: "rgba(255, 255, 255, 0.94)",
                                        borderRadius: s(999),
                                        paddingVertical: s(7),
                                        paddingHorizontal: s(12),
                                        borderWidth: 1,
                                        borderColor: colors.border,
                                        ...shadow.sm,
                                    }}
                                >
                                    <StepIndicator
                                        steps={STEPS}
                                        currentStep={state.step}
                                        compact
                                    />
                                </View>
                            </View>
                            <View
                                style={{
                                    flex: 1,
                                    alignItems: "flex-end",
                                    justifyContent: "center",
                                    zIndex: 1,
                                }}
                            >
                                <TouchableOpacity
                                    onPress={openExitPage}
                                    activeOpacity={0.85}
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: s(4),
                                        paddingVertical: s(6),
                                        paddingHorizontal: s(11),
                                        borderRadius: s(radii.full),
                                        borderWidth: 1,
                                        borderColor: "rgba(22, 81, 102, 0.14)",
                                        backgroundColor: colors.accentLight,
                                        ...shadow.sm,
                                    }}
                                >
                                    <Icon
                                        name="close"
                                        size={s(12)}
                                        color={colors.primaryDark}
                                    />
                                    <Text
                                        style={{
                                            fontSize: fs(10),
                                            fontWeight: "700",
                                            color: colors.primaryDark,
                                            letterSpacing: 0.15,
                                        }}
                                        allowFontScaling={false}
                                    >
                                        Exit
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                ) : (
                    <View
                        style={{
                            backgroundColor: colors.backgroundElevated,
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                            paddingHorizontal: s(spacing.lg),
                            paddingTop: s(spacing.sm),
                            paddingBottom: s(spacing.lg),
                            borderBottomLeftRadius: s(16),
                            borderBottomRightRadius: s(16),
                            overflow: "hidden",
                            ...shadow.sm,
                        }}
                    >
                        <View
                            style={{
                                height: s(3),
                                backgroundColor: colors.headerBar,
                                marginHorizontal: -s(spacing.lg),
                                marginTop: -s(spacing.sm),
                                marginBottom: s(spacing.md),
                            }}
                        />
                        <View
                            style={{
                                flexDirection: "row",
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                                marginBottom: s(spacing.md),
                            }}
                        >
                            <View
                                style={{
                                    flex: 1,
                                    paddingRight: s(spacing.sm),
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: fs(20),
                                        fontWeight: "800",
                                        color: colors.primary,
                                        letterSpacing: -0.35,
                                    }}
                                    allowFontScaling={false}
                                >
                                    Heigen Studio
                                </Text>
                                <Text
                                    style={{
                                        fontSize: fs(13),
                                        color: colors.mutedForeground,
                                        marginTop: s(3),
                                        lineHeight: fs(18),
                                        fontWeight: "500",
                                    }}
                                    allowFontScaling={false}
                                >
                                    Book your photoshoot appointment
                                </Text>
                            </View>
                            <TouchableOpacity
                                onPress={openExitPage}
                                activeOpacity={0.85}
                                style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: s(4),
                                    paddingVertical: s(6),
                                    paddingHorizontal: s(10),
                                    borderRadius: s(radii.full),
                                    borderWidth: 1,
                                    borderColor: "rgba(22, 81, 102, 0.14)",
                                    backgroundColor: colors.accentLight,
                                    ...shadow.sm,
                                }}
                            >
                                <Icon
                                    name="close"
                                    size={s(12)}
                                    color={colors.primaryDark}
                                />
                                <Text
                                    style={{
                                        fontSize: fs(10),
                                        fontWeight: "700",
                                        color: colors.primaryDark,
                                        letterSpacing: 0.15,
                                    }}
                                    allowFontScaling={false}
                                >
                                    Exit
                                </Text>
                            </TouchableOpacity>
                        </View>
                        <View
                            style={{
                                backgroundColor: colors.card,
                                borderRadius: s(radii.xl),
                                paddingVertical: s(spacing.md),
                                paddingHorizontal: s(spacing.lg),
                                borderWidth: 1,
                                borderColor: colors.border,
                                alignSelf: "stretch",
                                alignItems: "center",
                                ...shadow.sm,
                            }}
                        >
                            <StepIndicator
                                steps={STEPS}
                                currentStep={state.step}
                            />
                        </View>
                    </View>
                ))}
            <View style={{ flex: 1, overflow: "hidden" }}>
                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                    }}
                >
                    <View
                        style={{
                            position: "absolute",
                            top: -s(140),
                            right: -s(90),
                            width: s(340),
                            height: s(340),
                            borderRadius: s(170),
                            backgroundColor: atmosphere.blobCream,
                        }}
                    />
                    <View
                        style={{
                            position: "absolute",
                            bottom: -s(100),
                            left: -s(130),
                            width: s(400),
                            height: s(400),
                            borderRadius: s(200),
                            backgroundColor: atmosphere.blobTeal,
                        }}
                    />
                    <View
                        style={{
                            position: "absolute",
                            top: "32%",
                            left: "50%",
                            marginLeft: -s(150),
                            width: s(300),
                            height: s(300),
                            borderRadius: s(150),
                            backgroundColor: atmosphere.blobHighlight,
                        }}
                    />
                </View>
                {state.showExitPage && (
                    <View
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: colors.overlay,
                            zIndex: 30,
                            alignItems: "center",
                            justifyContent: "center",
                            padding: s(spacing.xl),
                        }}
                    >
                        <View
                            style={{
                                width: "100%",
                                maxWidth: isTablet ? 520 : 420,
                                backgroundColor: colors.card,
                                borderRadius: s(radii.xl),
                                borderTopWidth: 4,
                                borderTopColor: colors.primary,
                                padding: s(spacing.xxl),
                                gap: s(spacing.md),
                                ...shadow.lg,
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: fs(20),
                                    fontWeight: "700",
                                    color: colors.foreground,
                                }}
                                allowFontScaling={false}
                            >
                                Exit session?
                            </Text>
                            <Text
                                style={{
                                    fontSize: fs(14),
                                    color: colors.mutedForeground,
                                    lineHeight: fs(24),
                                }}
                                allowFontScaling={false}
                            >
                                Your selections will be cleared and the kiosk will reset for the next customer.
                            </Text>
                            <View
                                style={{
                                    flexDirection: "row",
                                    gap: s(spacing.md),
                                    marginTop: s(8),
                                }}
                            >
                                <TouchableOpacity
                                    onPress={closeExitPage}
                                    activeOpacity={0.85}
                                    style={{
                                        flex: 1,
                                        borderRadius: s(radii.md),
                                        borderWidth: 1.5,
                                        borderColor: colors.border,
                                        paddingVertical: s(14),
                                        alignItems: "center",
                                        backgroundColor: colors.backgroundElevated,
                                    }}
                                >
                                    <Text
                                        style={{
                                            color: colors.foreground,
                                            fontWeight: "600",
                                            fontSize: fs(16),
                                        }}
                                        allowFontScaling={false}
                                    >
                                        Continue
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={confirmExitSession}
                                    activeOpacity={0.9}
                                    style={{
                                        flex: 1,
                                        borderRadius: s(radii.md),
                                        backgroundColor: colors.primary,
                                        paddingVertical: s(14),
                                        alignItems: "center",
                                        ...shadow.accent,
                                    }}
                                >
                                    <Text
                                        style={{
                                            color: "#fff",
                                            fontWeight: "700",
                                            fontSize: fs(16),
                                        }}
                                        allowFontScaling={false}
                                    >
                                        Exit
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                )}
                {state.step === 0 && (
                    <CategoryScreen
                        onSelectCategory={handleSelectCategory}
                        recommendationData={state.recommendationData}
                        onSelectRecommendation={handleQuickBookRecommendation}
                        cachedCategories={kioskSnapshot.categories}
                    />
                )}
                {state.step === 1 && (
                    <PackageScreen
                        category={state.selectedCategory}
                        onSelectPackage={handleSelectPackage}
                        onBack={handleBackToCategory}
                        kioskSnapshot={kioskSnapshot}
                    />
                )}
                {state.step === 2 && (
                    <AddonsScreen
                        category={state.selectedCategory}
                        selectedPackage={state.selectedPackage}
                        selectedAddons={state.selectedAddons}
                        onToggleAddon={handleToggleAddon}
                        onNext={handleProceedToBookNow}
                        onBack={handleBackToPackages}
                        kioskSnapshot={kioskSnapshot}
                    />
                )}
                {state.step === 3 && (
                    <ConfirmationScreen
                        customerInfo={state.customerInfo}
                        onReset={reset}
                    />
                )}
            </View>
            <CustomerFormModal
                visible={state.showCustomerForm}
                onClose={() => update({ showCustomerForm: false })}
                onSubmit={handleCustomerFormSubmit}
                onCheckEmail={async (email) => {
                    const customer = await findCustomerByEmail(email);
                    return { found: !!customer, customer: customer || null };
                }}
                loading={state.loadingCustomerCheck}
                requireSubmit={!state.customerInfo}
                resetToken={state.formResetToken}
            />
            <BookingSummaryModal
                visible={state.showSummary}
                onClose={() => update({ showSummary: false })}
                onEdit={handleEditSelection}
                onConfirm={handleConfirmBooking}
                category={state.selectedCategory}
                selectedPackage={state.selectedPackage}
                selectedAddons={state.selectedAddons}
                customerInfo={state.customerInfo}
                customerId={state.customerId}
                loading={state.submitting}
                selectedCoupon={state.selectedCoupon}
                couponDiscount={state.couponDiscount}
                subtotal={calcTotal()}
                onSelectCoupon={(coupon, discount) =>
                    update({ selectedCoupon: coupon, couponDiscount: discount })
                }
                onRemoveCoupon={() =>
                    update({ selectedCoupon: null, couponDiscount: 0 })
                }
                availableCoupons={state.availableCoupons}
            />
        </SafeAreaView>
    );
}
