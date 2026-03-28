// src/screens/KioskApp.js
import React, { useState, useCallback } from "react";
import {
    View,
    Text,
    SafeAreaView,
    Alert,
    TouchableOpacity,
} from "react-native";
import { StatusBar } from "expo-status-bar";

import { StepIndicator } from "../components/ui";
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
    submitBooking,
} from "../api/client";
import { colors, spacing, typography } from "../constants/theme";
import { useScale } from "../hooks/useScale";

const STEPS = ["Category", "Package", "Add-ons", "Confirm"];

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
    const { s, fs, isTablet } = useScale();

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
                recommendationData = await fetchPopularRecommendations(3);
            }
        } catch (_) {
            try {
                recommendationData = await fetchPopularRecommendations(3);
            } catch (__) {
                recommendationData = { recommendations: [] };
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

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
            <StatusBar style="dark" />
            {state.step < 3 &&
                (isTablet ? (
                    // ── TABLET header: two compact rows, ~72dp total ───────────────
                    // ── TABLET header: two compact rows, ~72dp total ───────────────────
                    //Row 1: brand name (no subtitle to save height)
                    // Row 2: full step indicator — gets the full width, no clipping
                    <View
                        style={{
                            backgroundColor: "#fff",
                            borderBottomWidth: 1,
                            borderBottomColor: "rgba(0,0,0,0.08)",
                            paddingHorizontal: 24,
                            paddingTop: 10,
                            paddingBottom: 10,
                            elevation: 2,
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 13,
                                fontWeight: "800",
                                color: colors.foreground,
                                letterSpacing: 0.3,
                                marginBottom: 8,
                            }}
                            allowFontScaling={false}
                        >
                            Heigen Studio
                        </Text>
                        <View style={{ alignItems: "center" }}>
                            <StepIndicator
                                steps={STEPS}
                                currentStep={state.step}
                                compact
                            />
                        </View>
                        <TouchableOpacity
                            onPress={openExitPage}
                            style={{
                                position: "absolute",
                                right: 24,
                                top: 10,
                                paddingVertical: 6,
                                paddingHorizontal: 10,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: "rgba(22,81,102,0.25)",
                                backgroundColor: "rgba(22,81,102,0.06)",
                            }}
                        >
                            <Text
                                style={{ fontSize: 11, fontWeight: "700", color: colors.foreground }}
                                allowFontScaling={false}
                            >
                                Exit
                            </Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    // ── PHONE header: stacked brand + subtitle + full step indicator ─
                    <View
                        style={{
                            backgroundColor: "#fff",
                            borderBottomWidth: 1,
                            borderBottomColor: "rgba(0,0,0,0.08)",
                            paddingHorizontal: s(spacing.xl),
                            paddingTop: s(spacing.lg),
                            paddingBottom: s(spacing.xl),
                            elevation: 2,
                        }}
                    >
                        <View style={{ marginBottom: s(spacing.lg) }}>
                            <Text
                                style={{
                                    fontSize: fs(typography.h2.fontSize),
                                    fontWeight: "700",
                                }}
                                allowFontScaling={false}
                            >
                                Heigen Studio
                            </Text>
                            <Text
                                style={{
                                    fontSize: fs(typography.sm.fontSize),
                                    color: colors.mutedForeground,
                                    marginTop: 2,
                                }}
                                allowFontScaling={false}
                            >
                                Book Your Photoshoot Appointment
                            </Text>
                        </View>
                        <View style={{ alignItems: "center" }}>
                            <StepIndicator
                                steps={STEPS}
                                currentStep={state.step}
                            />
                        </View>
                        <TouchableOpacity
                            onPress={openExitPage}
                            style={{
                                position: "absolute",
                                right: s(spacing.xl),
                                top: s(spacing.lg),
                                paddingVertical: s(6),
                                paddingHorizontal: s(10),
                                borderRadius: s(12),
                                borderWidth: 1,
                                borderColor: "rgba(22,81,102,0.25)",
                                backgroundColor: "rgba(22,81,102,0.06)",
                            }}
                        >
                            <Text
                                style={{ fontSize: fs(11), fontWeight: "700", color: colors.foreground }}
                                allowFontScaling={false}
                            >
                                Exit
                            </Text>
                        </TouchableOpacity>
                    </View>
                ))}
            <View style={{ flex: 1 }}>
                {state.showExitPage && (
                    <View
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: "rgba(0,0,0,0.45)",
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
                                backgroundColor: "#fff",
                                borderRadius: 16,
                                padding: s(spacing.xl),
                                gap: s(spacing.md),
                            }}
                        >
                            <Text style={{ fontSize: fs(20), fontWeight: "700", color: colors.foreground }} allowFontScaling={false}>
                                Exit Session
                            </Text>
                            <Text style={{ fontSize: fs(14), color: colors.mutedForeground }} allowFontScaling={false}>
                                Exit without booking? Current selections will be cleared and the kiosk will reset for the next customer.
                            </Text>
                            <View style={{ flexDirection: "row", gap: s(spacing.md), marginTop: s(8) }}>
                                <TouchableOpacity
                                    onPress={closeExitPage}
                                    style={{
                                        flex: 1,
                                        borderRadius: 12,
                                        borderWidth: 1,
                                        borderColor: colors.border,
                                        paddingVertical: s(12),
                                        alignItems: "center",
                                    }}
                                >
                                    <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: fs(14) }} allowFontScaling={false}>Continue</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={confirmExitSession}
                                    style={{
                                        flex: 1,
                                        borderRadius: 12,
                                        backgroundColor: colors.accent,
                                        paddingVertical: s(12),
                                        alignItems: "center",
                                    }}
                                >
                                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: fs(14) }} allowFontScaling={false}>Exit</Text>
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
                    />
                )}
                {state.step === 1 && (
                    <PackageScreen
                        category={state.selectedCategory}
                        onSelectPackage={handleSelectPackage}
                        onBack={handleBackToCategory}
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
