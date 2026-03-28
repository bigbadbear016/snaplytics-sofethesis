// src/screens/BookingSummaryModal.js
import React, { useState, useEffect } from "react";
import {
    View,
    Text,
    TextInput,
    ScrollView,
    TouchableOpacity,
    Modal,
    Pressable,
    ActivityIndicator,
} from "react-native";
import Icon from "../components/Icon";
import { Button } from "../components/ui";
import { colors, spacing, radii, shadow } from "../constants/theme";
import { useScale } from "../hooks/useScale";
import { validateCoupon } from "../api/client";

/** Shared coupon UI: "My coupons" and "Enter code" stay in sync via parent state. */
function CouponSection({
    tablet,
    s,
    fs,
    customerId,
    subtotalVal,
    selectedCoupon,
    couponDiscount,
    onSelectCoupon,
    onRemoveCoupon,
    availableCoupons = [],
}) {
    const [couponTab, setCouponTab] = useState(
        availableCoupons.length ? "mine" : "code",
    );
    const [couponCodeInput, setCouponCodeInput] = useState("");
    const [couponError, setCouponError] = useState("");
    const [validating, setValidating] = useState(false);

    useEffect(() => {
        if (availableCoupons.length) setCouponTab("mine");
        else setCouponTab("code");
    }, [availableCoupons]);

    async function applyCode(code) {
        const trimmed = (code || "").trim();
        if (!trimmed) {
            setCouponError("Enter a coupon code");
            return;
        }
        if (!customerId) {
            setCouponError("Customer must be identified to use a coupon");
            return;
        }
        setCouponError("");
        setValidating(true);
        try {
            const res = await validateCoupon(trimmed, customerId, subtotalVal || 0);
            if (res.valid && res.coupon_id != null) {
                onSelectCoupon?.(
                    { id: res.coupon_id, code: trimmed },
                    res.discount_amount ?? 0,
                );
                setCouponCodeInput("");
            } else {
                setCouponError(res.error || "Invalid coupon");
            }
        } catch (err) {
            setCouponError(err.message || "Could not validate coupon");
        } finally {
            setValidating(false);
        }
    }

    const tabBtn = (key, label) => (
        <TouchableOpacity
            key={key}
            onPress={() => {
                setCouponTab(key);
                setCouponError("");
            }}
            style={{
                flex: 1,
                paddingVertical: tablet ? 8 : s(spacing.sm),
                borderRadius: tablet ? 8 : s(radii.md),
                backgroundColor: couponTab === key ? colors.accent : "transparent",
                alignItems: "center",
            }}
        >
            <Text
                style={{
                    fontSize: tablet ? 11 : fs(12),
                    fontWeight: "700",
                    color: couponTab === key ? "#fff" : colors.mutedForeground,
                }}
                allowFontScaling={false}
            >
                {label}
            </Text>
        </TouchableOpacity>
    );

    if (customerId == null) return null;

    return (
        <>
            <View
                style={{
                    height: 1,
                    backgroundColor: colors.border,
                    marginVertical: tablet ? 8 : s(spacing.md),
                }}
            />
            <Text
                style={{
                    fontSize: tablet ? 10 : fs(11),
                    fontWeight: "700",
                    color: colors.mutedForeground,
                    marginBottom: tablet ? 6 : s(spacing.sm),
                }}
                allowFontScaling={false}
            >
                Coupon
            </Text>
            {availableCoupons.length > 0 && (
                <View
                    style={{
                        flexDirection: "row",
                        gap: 4,
                        marginBottom: tablet ? 8 : s(spacing.sm),
                        backgroundColor: "rgba(0,0,0,0.04)",
                        borderRadius: tablet ? 10 : s(radii.lg),
                        padding: 4,
                    }}
                >
                    {tabBtn("mine", "My coupons")}
                    {tabBtn("code", "Enter code")}
                </View>
            )}
            {selectedCoupon ? (
                <View
                    style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        backgroundColor: "rgba(34,197,94,0.1)",
                        padding: tablet ? 8 : s(spacing.md),
                        borderRadius: tablet ? 8 : s(radii.lg),
                        marginBottom: tablet ? 0 : s(spacing.md),
                    }}
                >
                    <Text
                        style={{
                            fontSize: tablet ? 12 : fs(14),
                            fontWeight: "600",
                        }}
                        allowFontScaling={false}
                    >
                        {selectedCoupon.code} (-₱{couponDiscount.toLocaleString()})
                    </Text>
                    <TouchableOpacity
                        onPress={() => onRemoveCoupon?.()}
                        style={{ padding: tablet ? 4 : s(spacing.sm) }}
                    >
                        <Icon
                            name="close"
                            size={tablet ? 18 : s(22)}
                            color={colors.mutedForeground}
                        />
                    </TouchableOpacity>
                </View>
            ) : couponTab === "mine" && availableCoupons.length > 0 ? (
                <View style={{ gap: tablet ? 6 : s(spacing.sm) }}>
                    {availableCoupons.map((c) => (
                        <TouchableOpacity
                            key={c.id}
                            onPress={() => applyCode(c.code)}
                            disabled={validating}
                            style={{
                                padding: tablet ? 10 : s(spacing.md),
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: tablet ? 8 : s(radii.lg),
                                backgroundColor: colors.background,
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: tablet ? 12 : fs(13),
                                    fontWeight: "700",
                                }}
                                allowFontScaling={false}
                            >
                                {c.code}
                            </Text>
                            {c.discount_preview ? (
                                <Text
                                    style={{
                                        fontSize: tablet ? 10 : fs(11),
                                        color: colors.mutedForeground,
                                    }}
                                    allowFontScaling={false}
                                >
                                    {c.discount_preview}
                                </Text>
                            ) : null}
                        </TouchableOpacity>
                    ))}
                    {couponError ? (
                        <Text
                            style={{
                                fontSize: tablet ? 11 : fs(12),
                                color: colors.error,
                            }}
                            allowFontScaling={false}
                        >
                            {couponError}
                        </Text>
                    ) : null}
                    {validating ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                    ) : null}
                </View>
            ) : (
                <View
                    style={{
                        gap: tablet ? 4 : s(spacing.sm),
                        marginBottom: tablet ? 0 : s(spacing.md),
                    }}
                >
                    <View style={{ flexDirection: "row", gap: tablet ? 8 : s(spacing.sm) }}>
                        <TextInput
                            value={couponCodeInput}
                            onChangeText={(t) => {
                                setCouponCodeInput(t);
                                setCouponError("");
                            }}
                            placeholder="Enter coupon code"
                            placeholderTextColor={colors.mutedForeground}
                            style={{
                                flex: 1,
                                fontSize: tablet ? 12 : fs(14),
                                paddingHorizontal: tablet ? 10 : s(spacing.md),
                                paddingVertical: tablet ? 8 : s(spacing.md),
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: tablet ? 8 : s(radii.lg),
                                backgroundColor: colors.background,
                            }}
                            editable={!validating}
                        />
                        <TouchableOpacity
                            onPress={() => applyCode(couponCodeInput)}
                            disabled={validating}
                            style={{
                                paddingHorizontal: tablet ? 12 : s(spacing.lg),
                                paddingVertical: tablet ? 8 : s(spacing.md),
                                backgroundColor: colors.accent,
                                borderRadius: tablet ? 8 : s(radii.lg),
                                justifyContent: "center",
                            }}
                        >
                            {validating ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text
                                    style={{
                                        fontSize: tablet ? 12 : fs(14),
                                        fontWeight: "600",
                                        color: "#fff",
                                    }}
                                    allowFontScaling={false}
                                >
                                    Apply
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>
                    {couponError ? (
                        <Text
                            style={{
                                fontSize: tablet ? 11 : fs(12),
                                color: colors.error,
                            }}
                            allowFontScaling={false}
                        >
                            {couponError}
                        </Text>
                    ) : null}
                </View>
            )}
        </>
    );
}

export default function BookingSummaryModal({
    visible,
    onClose,
    onEdit,
    onConfirm,
    category,
    selectedPackage,
    selectedAddons,
    customerInfo,
    customerId,
    loading,
    selectedCoupon,
    couponDiscount = 0,
    subtotal = 0,
    onSelectCoupon,
    onRemoveCoupon,
    availableCoupons = [],
}) {
    const { s, fs, isTablet, W } = useScale();

    if (!selectedPackage || !customerInfo) return null;

    const pkgPrice = Number(
        selectedPackage?.promo_price
            ? selectedPackage.promo_price
            : selectedPackage?.price
              ? selectedPackage.price
              : 0,
    );
    const addonsTotal = selectedAddons.reduce(
        (sum, a) => sum + Number(a.price),
        0,
    );
    const subtotalVal = subtotal || pkgPrice + addonsTotal;
    const grandTotal = subtotalVal - couponDiscount;
    const inclusions = Array.isArray(selectedPackage.inclusions)
        ? selectedPackage.inclusions
        : [];

    // ── TABLET: centered fixed dialog, no scroll, raw dp sizing ─────────────────
    if (isTablet) {
        const dialogW = Math.min(720, W * 0.86);

        return (
            <Modal
                visible={visible}
                transparent
                animationType="fade"
                onRequestClose={onClose}
            >
                <Pressable
                    style={{
                        flex: 1,
                        backgroundColor: "rgba(0,0,0,0.55)",
                        justifyContent: "center",
                        alignItems: "center",
                    }}
                    onPress={onClose}
                >
                    <Pressable onPress={(e) => e.stopPropagation()}>
                        <View
                            style={{
                                width: dialogW,
                                backgroundColor: "#fff",
                                borderRadius: 16,
                                overflow: "hidden",
                                ...shadow.lg,
                            }}
                        >
                            {/* ── Dialog header ── */}
                            <View
                                style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    paddingHorizontal: 20,
                                    paddingVertical: 14,
                                    borderBottomWidth: 1,
                                    borderBottomColor: colors.border,
                                }}
                            >
                                <Text
                                    style={{ fontSize: 15, fontWeight: "700" }}
                                    allowFontScaling={false}
                                >
                                    Booking Summary
                                </Text>
                                <TouchableOpacity
                                    onPress={onClose}
                                    style={{ padding: 6 }}
                                >
                                    <Icon
                                        name="close"
                                        size={18}
                                        color={colors.mutedForeground}
                                    />
                                </TouchableOpacity>
                            </View>

                            {/* ── Two-column body ── */}
                            <View
                                style={{
                                    flexDirection: "row",
                                    padding: 20,
                                    gap: 20,
                                }}
                            >
                                {/* Left column: customer info */}
                                <View
                                    style={{
                                        flex: 1,
                                        borderRightWidth: 1,
                                        borderRightColor: colors.border,
                                        paddingRight: 20,
                                    }}
                                >
                                    <Text
                                        style={{
                                            fontSize: 10,
                                            fontWeight: "700",
                                            color: colors.mutedForeground,
                                            textTransform: "uppercase",
                                            letterSpacing: 0.8,
                                            marginBottom: 10,
                                        }}
                                        allowFontScaling={false}
                                    >
                                        Customer
                                    </Text>
                                    <SRow
                                        label="Name"
                                        value={customerInfo.fullName}
                                    />
                                    <SRow
                                        label="Email"
                                        value={customerInfo.email}
                                    />
                                    <SRow
                                        label="Contact"
                                        value={customerInfo.contactNumber}
                                    />
                                    {customerInfo.preferredDate ? (
                                        <SRow
                                            label="Date"
                                            value={customerInfo.preferredDate}
                                        />
                                    ) : null}
                                </View>

                                {/* Right column: booking details */}
                                <View style={{ flex: 1.3 }}>
                                    <Text
                                        style={{
                                            fontSize: 10,
                                            fontWeight: "700",
                                            color: colors.mutedForeground,
                                            textTransform: "uppercase",
                                            letterSpacing: 0.8,
                                            marginBottom: 10,
                                        }}
                                        allowFontScaling={false}
                                    >
                                        Booking
                                    </Text>

                                    <SRow
                                        label="Category"
                                        value={category?.name}
                                    />
                                    <View
                                        style={{
                                            height: 1,
                                            backgroundColor: colors.border,
                                            marginVertical: 8,
                                        }}
                                    />

                                    {/* Package */}
                                    <View
                                        style={{
                                            flexDirection: "row",
                                            justifyContent: "space-between",
                                            alignItems: "flex-start",
                                            marginBottom: 4,
                                        }}
                                    >
                                        <View style={{ flex: 1 }}>
                                            <Text
                                                style={{
                                                    fontSize: 10,
                                                    color: colors.mutedForeground,
                                                    marginBottom: 2,
                                                }}
                                                allowFontScaling={false}
                                            >
                                                Package
                                            </Text>
                                            <Text
                                                style={{
                                                    fontSize: 13,
                                                    fontWeight: "600",
                                                }}
                                                allowFontScaling={false}
                                            >
                                                {selectedPackage.name}
                                            </Text>
                                            {inclusions
                                                .slice(0, 3)
                                                .map((item, i) => (
                                                    <Text
                                                        key={i}
                                                        style={{
                                                            fontSize: 11,
                                                            color: colors.mutedForeground,
                                                            marginLeft: 4,
                                                        }}
                                                        allowFontScaling={false}
                                                    >
                                                        • {item}
                                                    </Text>
                                                ))}
                                            {inclusions.length > 3 ? (
                                                <Text
                                                    style={{
                                                        fontSize: 11,
                                                        color: colors.mutedForeground,
                                                        marginLeft: 4,
                                                    }}
                                                    allowFontScaling={false}
                                                >
                                                    +{inclusions.length - 3}{" "}
                                                    more
                                                </Text>
                                            ) : null}
                                        </View>
                                        <Text
                                            style={{
                                                fontSize: 14,
                                                fontWeight: "700",
                                                color: colors.accent,
                                                marginLeft: 8,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            ₱{pkgPrice.toLocaleString()}
                                        </Text>
                                    </View>

                                    {/* Add-ons */}
                                    {selectedAddons.length > 0 && (
                                        <>
                                            <View
                                                style={{
                                                    height: 1,
                                                    backgroundColor:
                                                        colors.border,
                                                    marginVertical: 8,
                                                }}
                                            />
                                            <Text
                                                style={{
                                                    fontSize: 10,
                                                    color: colors.mutedForeground,
                                                    marginBottom: 4,
                                                }}
                                                allowFontScaling={false}
                                            >
                                                Add-ons
                                            </Text>
                                            {selectedAddons.map((addon) => (
                                                <View
                                                    key={addon.id}
                                                    style={{
                                                        flexDirection: "row",
                                                        justifyContent:
                                                            "space-between",
                                                        marginBottom: 3,
                                                    }}
                                                >
                                                    <Text
                                                        style={{
                                                            fontSize: 12,
                                                            fontWeight: "500",
                                                            flex: 1,
                                                        }}
                                                        allowFontScaling={false}
                                                    >
                                                        {addon.name}
                                                    </Text>
                                                    <Text
                                                        style={{
                                                            fontSize: 12,
                                                            fontWeight: "600",
                                                            color: colors.accent,
                                                        }}
                                                        allowFontScaling={false}
                                                    >
                                                        +₱
                                                        {Number(
                                                            addon.price,
                                                        ).toLocaleString()}
                                                    </Text>
                                                </View>
                                            ))}
                                        </>
                                    )}
                                    <CouponSection
                                        tablet
                                        s={s}
                                        fs={fs}
                                        customerId={customerId}
                                        subtotalVal={subtotalVal}
                                        selectedCoupon={selectedCoupon}
                                        couponDiscount={couponDiscount}
                                        onSelectCoupon={onSelectCoupon}
                                        onRemoveCoupon={onRemoveCoupon}
                                        availableCoupons={availableCoupons}
                                    />
                                </View>
                            </View>

                            {/* ── Total + notice + actions ── */}
                            <View
                                style={{
                                    paddingHorizontal: 20,
                                    paddingBottom: 20,
                                    gap: 12,
                                }}
                            >
                                {/* Total bar */}
                                <View
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        backgroundColor: "rgba(217,119,6,0.08)",
                                        borderWidth: 1.5,
                                        borderColor: colors.accent,
                                        borderRadius: 10,
                                        paddingHorizontal: 16,
                                        paddingVertical: 10,
                                    }}
                                >
                                    <View
                                        style={{
                                            flexDirection: "row",
                                            alignItems: "center",
                                            gap: 8,
                                            flex: 1,
                                        }}
                                    >
                                        <Icon
                                            name="time-outline"
                                            size={13}
                                            color={colors.accent}
                                        />
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                color: colors.mutedForeground,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            Will be{" "}
                                            <Text style={{ fontWeight: "700" }}>
                                                Pending
                                            </Text>{" "}
                                            until confirmed by staff
                                        </Text>
                                    </View>
                                    <View
                                        style={{
                                            alignItems: "flex-end",
                                            marginLeft: 16,
                                        }}
                                    >
                                        <Text
                                            style={{
                                                fontSize: 10,
                                                color: colors.mutedForeground,
                                                textTransform: "uppercase",
                                                letterSpacing: 0.4,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            Total
                                        </Text>
                                        <Text
                                            style={{
                                                fontSize: 20,
                                                fontWeight: "700",
                                                color: colors.accent,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            ₱{grandTotal.toLocaleString()}
                                        </Text>
                                    </View>
                                </View>

                                {/* Actions */}
                                <View style={{ flexDirection: "row", gap: 10 }}>
                                    <Button
                                        label="Edit Selection"
                                        icon="create-outline"
                                        variant="secondary"
                                        size="sm"
                                        onPress={onEdit}
                                        style={{
                                            flex: 1,
                                            height: 40,
                                            minHeight: 0,
                                        }}
                                        disabled={loading}
                                    />
                                    <Button
                                        label="Confirm Booking"
                                        onPress={onConfirm}
                                        size="sm"
                                        loading={loading}
                                        style={{
                                            flex: 1,
                                            height: 40,
                                            minHeight: 0,
                                        }}
                                    />
                                </View>
                            </View>
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>
        );
    }

    // ── PHONE: bottom sheet with scroll ──────────────────────────────────────────
    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <Pressable
                style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
                onPress={onClose}
            />
            <View
                style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    backgroundColor: "#fff",
                    borderTopLeftRadius: s(radii.xxl),
                    borderTopRightRadius: s(radii.xxl),
                    maxHeight: "92%",
                    ...shadow.lg,
                }}
            >
                <View
                    style={{
                        width: s(40),
                        height: s(4),
                        borderRadius: s(2),
                        backgroundColor: colors.border,
                        alignSelf: "center",
                        marginTop: s(spacing.md),
                    }}
                />
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingHorizontal: s(spacing.xxl),
                        paddingVertical: s(spacing.lg),
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                    }}
                >
                    <Text
                        style={{ fontSize: fs(18), fontWeight: "700" }}
                        allowFontScaling={false}
                    >
                        Booking Summary
                    </Text>
                    <TouchableOpacity
                        onPress={onClose}
                        style={{ padding: s(spacing.sm) }}
                    >
                        <Icon
                            name="close"
                            size={s(22)}
                            color={colors.mutedForeground}
                        />
                    </TouchableOpacity>
                </View>
                <ScrollView
                    contentContainerStyle={{
                        padding: s(spacing.xxl),
                        paddingBottom: s(spacing.xxxl),
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    <Text
                        style={{
                            fontSize: fs(11),
                            fontWeight: "700",
                            color: colors.mutedForeground,
                            textTransform: "uppercase",
                            letterSpacing: 0.6,
                            marginBottom: s(spacing.md),
                        }}
                        allowFontScaling={false}
                    >
                        Customer
                    </Text>
                    <PhoneRow
                        label="Name"
                        value={customerInfo.fullName}
                        s={s}
                        fs={fs}
                    />
                    <PhoneRow
                        label="Email"
                        value={customerInfo.email}
                        s={s}
                        fs={fs}
                    />
                    <PhoneRow
                        label="Contact"
                        value={customerInfo.contactNumber}
                        s={s}
                        fs={fs}
                    />
                    {customerInfo.preferredDate ? (
                        <PhoneRow
                            label="Date"
                            value={customerInfo.preferredDate}
                            s={s}
                            fs={fs}
                        />
                    ) : null}

                    <View
                        style={{
                            height: 1,
                            backgroundColor: colors.border,
                            marginVertical: s(spacing.lg),
                        }}
                    />

                    <Text
                        style={{
                            fontSize: fs(11),
                            fontWeight: "700",
                            color: colors.mutedForeground,
                            textTransform: "uppercase",
                            letterSpacing: 0.6,
                            marginBottom: s(spacing.md),
                        }}
                        allowFontScaling={false}
                    >
                        Booking
                    </Text>
                    <PhoneRow
                        label="Category"
                        value={category?.name}
                        s={s}
                        fs={fs}
                    />
                    <View
                        style={{
                            height: 1,
                            backgroundColor: colors.border,
                            marginVertical: s(spacing.md),
                        }}
                    />
                    <View
                        style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            marginBottom: s(spacing.sm),
                        }}
                    >
                        <View style={{ flex: 1 }}>
                            <Text
                                style={{
                                    fontSize: fs(12),
                                    color: colors.mutedForeground,
                                }}
                                allowFontScaling={false}
                            >
                                Package
                            </Text>
                            <Text
                                style={{ fontSize: fs(15), fontWeight: "600" }}
                                allowFontScaling={false}
                            >
                                {selectedPackage.name}
                            </Text>
                            {inclusions.map((item, i) => (
                                <Text
                                    key={i}
                                    style={{
                                        fontSize: fs(12),
                                        color: colors.mutedForeground,
                                        marginLeft: s(spacing.sm),
                                    }}
                                    allowFontScaling={false}
                                >
                                    • {item}
                                </Text>
                            ))}
                        </View>
                        <Text
                            style={{
                                fontSize: fs(16),
                                fontWeight: "700",
                                color: colors.accent,
                            }}
                            allowFontScaling={false}
                        >
                            ₱{pkgPrice.toLocaleString()}
                        </Text>
                    </View>
                    {selectedAddons.length > 0 && (
                        <>
                            <View
                                style={{
                                    height: 1,
                                    backgroundColor: colors.border,
                                    marginVertical: s(spacing.md),
                                }}
                            />
                            <Text
                                style={{
                                    fontSize: fs(12),
                                    color: colors.mutedForeground,
                                    marginBottom: s(spacing.sm),
                                }}
                                allowFontScaling={false}
                            >
                                Add-ons
                            </Text>
                            {selectedAddons.map((addon) => (
                                <View
                                    key={addon.id}
                                    style={{
                                        flexDirection: "row",
                                        justifyContent: "space-between",
                                        marginBottom: s(spacing.sm),
                                    }}
                                >
                                    <Text
                                        style={{
                                            fontSize: fs(14),
                                            fontWeight: "500",
                                            flex: 1,
                                        }}
                                        allowFontScaling={false}
                                    >
                                        {addon.name}
                                    </Text>
                                    <Text
                                        style={{
                                            fontSize: fs(14),
                                            fontWeight: "600",
                                            color: colors.accent,
                                        }}
                                        allowFontScaling={false}
                                    >
                                        +₱{Number(addon.price).toLocaleString()}
                                    </Text>
                                </View>
                                            ))}
                                        </>
                                    )}
                                    <CouponSection
                                        tablet={false}
                                        s={s}
                                        fs={fs}
                                        customerId={customerId}
                                        subtotalVal={subtotalVal}
                                        selectedCoupon={selectedCoupon}
                                        couponDiscount={couponDiscount}
                                        onSelectCoupon={onSelectCoupon}
                                        onRemoveCoupon={onRemoveCoupon}
                                        availableCoupons={availableCoupons}
                                    />
                                    <View
                                        style={{
                                            flexDirection: "row",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            backgroundColor: "rgba(217,119,6,0.08)",
                                            borderWidth: 2,
                                            borderColor: colors.accent,
                                            borderRadius: s(radii.xl),
                                            padding: s(spacing.xl),
                                            marginVertical: s(spacing.lg),
                                        }}
                                    >
                                        <Text
                                            style={{ fontSize: fs(15), fontWeight: "600" }}
                                            allowFontScaling={false}
                                        >
                                            Total Amount
                                        </Text>
                        <Text
                            style={{
                                fontSize: fs(28),
                                fontWeight: "700",
                                color: colors.accent,
                            }}
                            allowFontScaling={false}
                        >
                            ₱{grandTotal.toLocaleString()}
                        </Text>
                    </View>
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "flex-start",
                            gap: s(spacing.sm),
                            backgroundColor: "rgba(217,119,6,0.06)",
                            borderRadius: s(radii.lg),
                            padding: s(spacing.lg),
                            marginBottom: s(spacing.xl),
                        }}
                    >
                        <Icon
                            name="time-outline"
                            size={s(16)}
                            color={colors.accent}
                        />
                        <Text
                            style={{
                                fontSize: fs(13),
                                color: colors.mutedForeground,
                                flex: 1,
                                lineHeight: fs(19),
                            }}
                            allowFontScaling={false}
                        >
                            Your booking will be{" "}
                            <Text style={{ fontWeight: "700" }}>Pending</Text>{" "}
                            until confirmed by staff.
                        </Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: s(spacing.lg) }}>
                        <Button
                            label="Edit Selection"
                            icon="create-outline"
                            variant="secondary"
                            size="sm"
                            onPress={onEdit}
                            style={{ flex: 1 }}
                            disabled={loading}
                        />
                        <Button
                            label="Confirm Booking"
                            onPress={onConfirm}
                            size="sm"
                            loading={loading}
                            style={{ flex: 1 }}
                        />
                    </View>
                </ScrollView>
            </View>
        </Modal>
    );
}

function SRow({ label, value }) {
    return (
        <View style={{ flexDirection: "row", marginBottom: 7 }}>
            <Text
                style={{
                    fontSize: 11,
                    color: colors.mutedForeground,
                    width: 58,
                }}
                allowFontScaling={false}
            >
                {label}:
            </Text>
            <Text
                style={{ fontSize: 12, fontWeight: "600", flex: 1 }}
                allowFontScaling={false}
            >
                {value}
            </Text>
        </View>
    );
}
function PhoneRow({ label, value, s, fs }) {
    return (
        <View style={{ flexDirection: "row", marginBottom: s(spacing.sm) }}>
            <Text
                style={{
                    fontSize: fs(13),
                    color: colors.mutedForeground,
                    width: s(90),
                }}
                allowFontScaling={false}
            >
                {label}:
            </Text>
            <Text
                style={{ fontSize: fs(13), fontWeight: "600", flex: 1 }}
                allowFontScaling={false}
            >
                {value}
            </Text>
        </View>
    );
}
