// src/screens/AddonsScreen.js
import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import Icon from "../components/Icon";
import { useApi } from "../hooks/useApi";
import {
    fetchAddons,
    fetchPopularAddons,
    snapshotAddonsForCategory,
    snapshotPopularAddons,
} from "../api/client";
import { LoadingScreen, ErrorScreen, Button } from "../components/ui";
import { colors, spacing, radii, shadow } from "../constants/theme";
import { useScale } from "../hooks/useScale";
import { effectivePackagePriceForClaim } from "../utils/loyaltyClaim";
import { addonQty, sumAddonLineSubtotals, totalAddonUnits } from "../utils/addonLines";

export default function AddonsScreen({
    category,
    selectedPackage,
    selectedAddons,
    onIncrementAddon,
    onDecrementAddon,
    onNext,
    onBack,
    kioskSnapshot = null,
}) {
    const { s, fs, isTablet, W } = useScale();
    const [scrollY, setScrollY] = useState(0);
    const [contentHeight, setContentHeight] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const catName = category?.name;
    const fetchAddonsAndPopular = useCallback(async () => {
        const [list, pop] = await Promise.all([
            fetchAddons(catName),
            fetchPopularAddons(catName),
        ]);
        return { list, pop };
    }, [catName]);

    const useSnapshot = !!kioskSnapshot;
    const { data: bundle, loading, error, refetch } = useApi(
        fetchAddonsAndPopular,
        [],
        { enabled: !useSnapshot },
    );
    const addons = useSnapshot
        ? snapshotAddonsForCategory(kioskSnapshot, catName)
        : bundle?.list;
    const popularData = useSnapshot
        ? snapshotPopularAddons(kioskSnapshot, catName)
        : bundle?.pop;
    const popularIds = popularData?.top_addon_ids ?? [];

    if (loading) return <LoadingScreen message="Loading add-ons..." />;
    if (error) return <ErrorScreen message={error} onRetry={refetch} />;

    const popularAddons =
        addons?.filter((a) => popularIds.includes(a.id)) ?? [];
    const otherAddons = addons?.filter((a) => !popularIds.includes(a.id)) ?? [];
    const displayPopular =
        popularAddons.length > 0 ? popularAddons : (addons?.slice(0, 2) ?? []);
    const displayOther =
        popularAddons.length > 0 ? otherAddons : (addons?.slice(2) ?? []);

    const pkgPrice = effectivePackagePriceForClaim(selectedPackage);
    const addonsTotal = sumAddonLineSubtotals(selectedAddons);
    const addonUnits = totalAddonUnits(selectedAddons);
    const grandTotal = pkgPrice + addonsTotal;

    const hPad = s(spacing.xl);
    const colGap = s(spacing.md);
    const cardWidth = isTablet ? (W - hPad * 2 - colGap) / 2 : undefined;
    const footerH = isTablet
        ? 68
        : s(52) + s(spacing.lg) * 2 + s(spacing.xl) * 2 + s(52);
    const extraBottomSpace = s(spacing.xxxl);
    const maxScroll = Math.max(0, contentHeight - viewportHeight);
    const canScrollDown = maxScroll > s(8);
    const isNearBottom = scrollY >= maxScroll - s(20);
    const showScrollHint = canScrollDown && !isNearBottom;

    function renderGrid(list, isPopular) {
        return (
            <View
                style={
                    isTablet
                        ? { flexDirection: "row", flexWrap: "wrap", gap: colGap }
                        : { gap: s(spacing.sm) }
                }
            >
                {list.map((addon) => {
                    const line = selectedAddons.find((a) => a.id === addon.id);
                    const qty = line ? addonQty(line) : 0;
                    return (
                        <AddonCard
                            key={addon.id}
                            addon={addon}
                            isPopular={isPopular}
                            quantity={qty}
                            onIncrement={() => onIncrementAddon(addon)}
                            onDecrement={() => onDecrementAddon(addon)}
                            s={s}
                            fs={fs}
                            width={cardWidth}
                        />
                    );
                })}
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            <ScrollView
                contentContainerStyle={{
                    padding: hPad,
                    paddingBottom: footerH + extraBottomSpace,
                }}
                showsVerticalScrollIndicator={false}
                onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
                onContentSizeChange={(_, h) => setContentHeight(h)}
                onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
                scrollEventThrottle={16}
            >
                <Button
                    label="Back to Packages"
                    icon="arrow-back"
                    variant="ghost"
                    onPress={onBack}
                    style={{
                        alignSelf: "flex-start",
                        marginBottom: s(spacing.md),
                    }}
                    labelStyle={{ color: colors.mutedForeground }}
                />

                <View style={{ alignItems: "center", marginBottom: s(spacing.xl) }}>
                    <View
                        style={{
                            width: s(40),
                            height: s(4),
                            borderRadius: s(2),
                            backgroundColor: colors.primary,
                            opacity: 0.85,
                            marginBottom: s(spacing.md),
                        }}
                    />
                    <Text
                        style={{
                            fontSize: fs(22),
                            fontWeight: "800",
                            textAlign: "center",
                            color: colors.foreground,
                            letterSpacing: -0.3,
                        }}
                        allowFontScaling={false}
                    >
                        Enhance your session
                    </Text>
                    <Text
                        style={{
                            fontSize: fs(14),
                            color: colors.mutedForeground,
                            textAlign: "center",
                            marginTop: s(6),
                            lineHeight: fs(20),
                            paddingHorizontal: s(spacing.md),
                        }}
                        allowFontScaling={false}
                    >
                        Optional add-ons — tap + to add, − to remove
                    </Text>
                </View>

                {displayPopular.length > 0 && (
                    <View style={{ marginBottom: s(spacing.xl) }}>
                        <Text
                            style={{
                                fontSize: fs(12),
                                color: colors.accent,
                                fontWeight: "700",
                                marginBottom: s(spacing.sm),
                                textTransform: "uppercase",
                                letterSpacing: 0.6,
                            }}
                            allowFontScaling={false}
                        >
                            Popular Add-ons For {catName}
                        </Text>
                        {renderGrid(displayPopular, true)}
                    </View>
                )}

                {displayOther.length > 0 && (
                    <View>
                        <Text
                            style={{
                                fontSize: fs(12),
                                color: colors.mutedForeground,
                                fontWeight: "700",
                                marginBottom: s(spacing.sm),
                                textTransform: "uppercase",
                                letterSpacing: 0.6,
                            }}
                            allowFontScaling={false}
                        >
                            More Add-ons
                        </Text>
                        {renderGrid(displayOther, false)}
                    </View>
                )}

                {(!addons || addons.length === 0) && (
                    <View
                        style={{
                            alignItems: "center",
                            padding: s(spacing.xxxl),
                        }}
                    >
                        <Text
                            style={{
                                fontSize: fs(16),
                                color: colors.mutedForeground,
                                textAlign: "center",
                            }}
                            allowFontScaling={false}
                        >
                            No add-ons available for this category.
                        </Text>
                    </View>
                )}
            </ScrollView>

            {showScrollHint && (
                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: footerH + s(spacing.sm),
                        alignItems: "center",
                    }}
                >
                    <View
                        style={{
                            width: s(34),
                            height: s(34),
                            borderRadius: s(17),
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "rgba(255,255,255,0.74)",
                            borderWidth: 1,
                            borderColor: "rgba(0,0,0,0.08)",
                            ...shadow.sm,
                        }}
                    >
                        <Icon
                            name="chevron-down"
                            size={s(16)}
                            color={colors.mutedForeground}
                        />
                    </View>
                </View>
            )}

            {/* Sticky footer — tablet: single row; phone: two rows */}
            <View
                style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    backgroundColor: colors.backgroundElevated,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    paddingHorizontal: s(spacing.xl),
                    paddingVertical: isTablet ? 14 : s(spacing.lg),
                    ...shadow.lg,
                }}
            >
                {isTablet ? (
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: s(spacing.xl),
                        }}
                    >
                        <View style={{ flex: 2 }}>
                            <Text
                                style={{
                                    fontSize: 11,
                                    color: colors.mutedForeground,
                                    fontWeight: "600",
                                    textTransform: "uppercase",
                                    letterSpacing: 0.4,
                                }}
                                allowFontScaling={false}
                            >
                                Package
                            </Text>
                            <Text
                                style={{ fontSize: 13, fontWeight: "600" }}
                                numberOfLines={1}
                                allowFontScaling={false}
                            >
                                {selectedPackage?.name}
                                <Text style={{ color: colors.accent }}>
                                    {"  "}₱{pkgPrice.toLocaleString()}
                                </Text>
                            </Text>
                        </View>
                        {selectedAddons.length > 0 && (
                            <View
                                style={{
                                    flex: 1,
                                    borderLeftWidth: 1,
                                    borderLeftColor: colors.border,
                                    paddingLeft: s(spacing.lg),
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: 11,
                                        color: colors.mutedForeground,
                                        fontWeight: "600",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                    }}
                                    allowFontScaling={false}
                                >
                                    Add-ons
                                </Text>
                                <Text
                                    style={{
                                        fontSize: 13,
                                        fontWeight: "600",
                                        color: colors.accent,
                                    }}
                                    allowFontScaling={false}
                                >
                                    +₱{addonsTotal.toLocaleString()} (
                                    {addonUnits})
                                </Text>
                            </View>
                        )}
                        <View
                            style={{
                                flex: 1,
                                borderLeftWidth: 1,
                                borderLeftColor: colors.border,
                                paddingLeft: s(spacing.lg),
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 11,
                                    color: colors.mutedForeground,
                                    fontWeight: "600",
                                    textTransform: "uppercase",
                                    letterSpacing: 0.4,
                                }}
                                allowFontScaling={false}
                            >
                                Total
                            </Text>
                            <Text
                                style={{
                                    fontSize: 17,
                                    fontWeight: "700",
                                    color: colors.accent,
                                }}
                                allowFontScaling={false}
                            >
                                ₱{grandTotal.toLocaleString()}
                            </Text>
                        </View>
                        <Button
                            label="Book Now"
                            onPress={onNext}
                            style={{
                                flexShrink: 0,
                                paddingHorizontal: s(spacing.xxl),
                                height: 40,
                            }}
                        />
                    </View>
                ) : (
                    <>
                        <View
                            style={{
                                flexDirection: "row",
                                marginBottom: s(spacing.md),
                            }}
                        >
                            <View style={{ flex: 1 }}>
                                <Text
                                    style={{
                                        fontSize: fs(11),
                                        color: colors.mutedForeground,
                                    }}
                                    allowFontScaling={false}
                                >
                                    Package
                                </Text>
                                <Text
                                    style={{
                                        fontSize: fs(13),
                                        fontWeight: "600",
                                    }}
                                    numberOfLines={1}
                                    allowFontScaling={false}
                                >
                                    {selectedPackage?.name}
                                </Text>
                                <Text
                                    style={{
                                        fontSize: fs(12),
                                        color: colors.accent,
                                        fontWeight: "600",
                                    }}
                                    allowFontScaling={false}
                                >
                                    ₱{pkgPrice.toLocaleString()}
                                </Text>
                            </View>
                            {selectedAddons.length > 0 && (
                                <View
                                    style={{
                                        flex: 1,
                                        borderLeftWidth: 1,
                                        borderLeftColor: colors.border,
                                        paddingLeft: s(spacing.lg),
                                    }}
                                >
                                    <Text
                                        style={{
                                            fontSize: fs(11),
                                            color: colors.mutedForeground,
                                        }}
                                        allowFontScaling={false}
                                    >
                                        Add-ons
                                    </Text>
                                    <Text
                                        style={{
                                            fontSize: fs(13),
                                            fontWeight: "600",
                                        }}
                                        allowFontScaling={false}
                                    >
                                        {addonUnits} item(s)
                                    </Text>
                                    <Text
                                        style={{
                                            fontSize: fs(12),
                                            color: colors.accent,
                                            fontWeight: "600",
                                        }}
                                        allowFontScaling={false}
                                    >
                                        +₱{addonsTotal.toLocaleString()}
                                    </Text>
                                </View>
                            )}
                            <View
                                style={{
                                    flex: 1,
                                    borderLeftWidth: 1,
                                    borderLeftColor: colors.border,
                                    paddingLeft: s(spacing.lg),
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: fs(11),
                                        color: colors.mutedForeground,
                                    }}
                                    allowFontScaling={false}
                                >
                                    Total
                                </Text>
                                <Text
                                    style={{
                                        fontSize: fs(20),
                                        fontWeight: "700",
                                        color: colors.accent,
                                    }}
                                    allowFontScaling={false}
                                >
                                    ₱{grandTotal.toLocaleString()}
                                </Text>
                            </View>
                        </View>
                        <Button
                            label="Book Now"
                            onPress={onNext}
                            fullWidth
                            style={{ height: s(48) }}
                        />
                    </>
                )}
            </View>
        </View>
    );
}

// Popular: warm amber border + cream fill. Other: white + grey border. No badges, no containers.
function AddonCard({
    addon,
    isPopular,
    quantity,
    onIncrement,
    onDecrement,
    s,
    fs,
    width,
}) {
    const hasQty = quantity > 0;
    const borderColor = hasQty
        ? colors.primary
        : isPopular
          ? colors.borderStrong
          : colors.border;

    return (
        <View
            style={{
                borderRadius: s(radii.lg),
                borderWidth: hasQty ? 2 : 1.5,
                borderColor: borderColor,
                backgroundColor: hasQty
                    ? colors.accentLight
                    : isPopular
                      ? colors.backgroundElevated
                      : colors.card,
                padding: s(spacing.md),
                ...(hasQty ? shadow.accent : shadow.sm),
                position: "relative",
                width: width || undefined,
            }}
        >
            {/* Popular star at top center */}
            {isPopular && !hasQty && (
                <View
                    style={{
                        position: "absolute",
                        top: -s(10),
                        left: "50%",
                        transform: [{ translateX: -s(10) }],
                        width: s(20),
                        height: s(20),
                        borderRadius: s(10),
                        backgroundColor: borderColor,
                        alignItems: "center",
                        justifyContent: "center",
                        elevation: 3,
                    }}
                >
                    <Icon name="star" size={s(12)} color="#fff" />
                </View>
            )}

            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: s(spacing.lg),
                }}
            >
                <View
                    style={{
                        width: s(28),
                        height: s(28),
                        borderRadius: s(14),
                        flexShrink: 0,
                        borderWidth: 2,
                        borderColor: borderColor,
                        backgroundColor: hasQty ? colors.accent : "#ffffff",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Icon
                        name={hasQty ? "checkmark" : "add"}
                        size={s(13)}
                        color={
                            hasQty
                                ? "#fff"
                                : isPopular
                                  ? colors.accent
                                  : colors.mutedForeground
                        }
                    />
                </View>
                <View style={{ flex: 1 }}>
                    <Text
                        style={{
                            fontSize: fs(13),
                            fontWeight: "600",
                            color: hasQty
                                ? colors.accent
                                : colors.foreground,
                        }}
                        allowFontScaling={false}
                    >
                        {addon.name}
                    </Text>
                    {!!addon.additional_info && (
                        <Text
                            style={{
                                fontSize: fs(11),
                                color: colors.mutedForeground,
                                marginTop: s(2),
                            }}
                            allowFontScaling={false}
                        >
                            {String(addon.additional_info)}
                        </Text>
                    )}
                </View>
                <Text
                    style={{
                        fontSize: fs(13),
                        fontWeight: "700",
                        color: colors.accent,
                        flexShrink: 0,
                    }}
                    allowFontScaling={false}
                >
                    +₱{Number(addon.price).toLocaleString()}
                    {hasQty && quantity > 1 ? (
                        <Text
                            style={{
                                fontSize: fs(11),
                                color: colors.mutedForeground,
                                fontWeight: "600",
                            }}
                            allowFontScaling={false}
                        >
                            {" "}
                            ×{quantity}
                        </Text>
                    ) : null}
                </Text>
            </View>
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    marginTop: s(spacing.sm),
                    gap: s(spacing.sm),
                }}
            >
                {hasQty ? (
                    <TouchableOpacity
                        onPress={onDecrement}
                        activeOpacity={0.85}
                        style={{
                            width: s(36),
                            height: s(36),
                            borderRadius: s(18),
                            borderWidth: 2,
                            borderColor: colors.primary,
                            backgroundColor: colors.backgroundElevated,
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <Icon
                            name="remove"
                            size={s(16)}
                            color={colors.primary}
                        />
                    </TouchableOpacity>
                ) : null}
                {hasQty ? (
                    <Text
                        style={{
                            fontSize: fs(15),
                            fontWeight: "800",
                            color: colors.foreground,
                            minWidth: s(28),
                            textAlign: "center",
                        }}
                        allowFontScaling={false}
                    >
                        {quantity}
                    </Text>
                ) : null}
                <TouchableOpacity
                    onPress={onIncrement}
                    activeOpacity={0.85}
                    style={{
                        width: s(36),
                        height: s(36),
                        borderRadius: s(18),
                        borderWidth: 2,
                        borderColor: colors.accent,
                        backgroundColor: colors.accent,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Icon name="add" size={s(16)} color="#fff" />
                </TouchableOpacity>
            </View>
        </View>
    );
}
