// src/screens/PackageScreen.js
import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Image } from "react-native";
import Icon from "../components/Icon";
import { useApi } from "../hooks/useApi";
import { fetchPackages, fetchPopularPackage } from "../api/client";
import { LoadingScreen, ErrorScreen, Button } from "../components/ui";
import { colors, spacing, radii, shadow } from "../constants/theme";
import { useScale } from "../hooks/useScale";
import { resolvePackageImage } from "../constants/assets";

export default function PackageScreen({ category, onSelectPackage, onBack }) {
    const { s, fs, isTablet, W } = useScale();
    const [scrollY, setScrollY] = useState(0);
    const [contentHeight, setContentHeight] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const catName = category?.name;
    const fetchPkgs = useCallback(() => fetchPackages(catName), [catName]);
    const fetchPop = useCallback(() => fetchPopularPackage(catName), [catName]);

    const { data: packages, loading, error, refetch } = useApi(fetchPkgs);
    const { data: popularData } = useApi(fetchPop);

    if (loading) return <LoadingScreen message="Loading packages..." />;
    if (error) return <ErrorScreen message={error} onRetry={refetch} />;
    if (!packages?.length)
        return (
            <View
                style={{
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <Text
                    style={{ fontSize: fs(16), color: colors.mutedForeground }}
                >
                    No packages found for {catName}.
                </Text>
                <Button
                    label="Go Back"
                    onPress={onBack}
                    variant="ghost"
                    style={{ marginTop: s(spacing.xl) }}
                />
            </View>
        );

    const popularId = popularData?.top_package_id ?? packages[0]?.id;
    const popularPkg = packages.find((p) => p.id === popularId) ?? packages[0];
    const otherPkgs = packages.filter((p) => p.id !== popularPkg?.id);
    const orderedPackages = [popularPkg, ...otherPkgs].filter(Boolean);
    const hPad = s(spacing.xl);
    const colGap = s(spacing.md);
    const cardWidth = isTablet ? (W - hPad * 2 - colGap) / 2 : undefined;
    const maxScroll = Math.max(0, contentHeight - viewportHeight);
    const canScrollDown = maxScroll > s(8);
    const isNearBottom = scrollY >= maxScroll - s(20);
    const showScrollHint = canScrollDown && !isNearBottom;

    return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            <ScrollView
                style={{ flex: 1, backgroundColor: colors.background }}
                contentContainerStyle={{ padding: hPad, paddingBottom: s(64) }}
                showsVerticalScrollIndicator={false}
                onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
                onContentSizeChange={(_, h) => setContentHeight(h)}
                onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
                scrollEventThrottle={16}
            >
            <Button
                label="Back to Categories"
                icon="arrow-back"
                variant="ghost"
                onPress={onBack}
                style={{ alignSelf: "flex-start", marginBottom: s(spacing.md) }}
                labelStyle={{ color: colors.mutedForeground }}
            />

            <Text
                style={{
                    fontSize: fs(22),
                    fontWeight: "700",
                    textAlign: "center",
                    marginBottom: s(2),
                }}
                allowFontScaling={false}
            >
                Select a Package
            </Text>
            <Text
                style={{
                    fontSize: fs(14),
                    color: colors.mutedForeground,
                    textAlign: "center",
                    marginBottom: s(spacing.xl),
                }}
                allowFontScaling={false}
            >
                for {catName}
            </Text>

                <View
                    style={
                        isTablet
                            ? { flexDirection: "row", flexWrap: "wrap", gap: colGap }
                            : { gap: s(spacing.sm) }
                    }
                >
                    {orderedPackages.map((pkg, idx) => (
                        <PackageCard
                            key={pkg.id}
                            pkg={pkg}
                            onPress={() => onSelectPackage(pkg)}
                            popular={idx === 0}
                            s={s}
                            fs={fs}
                            width={cardWidth}
                        />
                    ))}
                </View>
            </ScrollView>
            {showScrollHint && (
                <View
                    pointerEvents="none"
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: s(spacing.xl),
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
        </View>
    );
}

function toStringArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "object") return Object.values(val).map(String);
    return [String(val)];
}
function hasPromo(pkg) {
    return pkg.promo_price != null && Number(pkg.promo_price) > 0;
}

function IncludeRow({ text, color, s, fs }) {
    return (
        <View
            style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: s(spacing.sm),
                marginBottom: s(4),
            }}
        >
            <Icon
                name="checkmark"
                size={s(13)}
                color={color || colors.accent}
            />
            <Text
                style={{
                    fontSize: fs(13),
                    color: color || colors.mutedForeground,
                    flex: 1,
                }}
                allowFontScaling={false}
            >
                {text}
            </Text>
        </View>
    );
}

// Popular: amber border + warm cream fill + star circle. Other: white + grey border.
function PackageCard({ pkg, onPress, popular = false, s, fs, width }) {
    const borderColor = popular ? "rgba(217,119,6,0.7)" : colors.border;
    const bgColor = "#ffffff";
    const price = hasPromo(pkg) ? pkg.promo_price : pkg.price;
    const inclusions = toStringArray(pkg.inclusions);
    const freebies = toStringArray(pkg.freebies);
    const packageImage = resolvePackageImage(pkg);
    const imageHeight = popular ? s(156) : s(132);

    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.85}
            style={{
                borderRadius: s(radii.xl),
                borderWidth: popular ? 2 : 1.5,
                borderColor: borderColor,
                backgroundColor: bgColor,
                ...(popular ? shadow.accent : shadow.sm),
                position: "relative",
                overflow: "hidden",
                width: width || undefined,
            }}
        >
            <View style={{ height: imageHeight, backgroundColor: colors.muted }}>
                <Image
                    source={{ uri: packageImage }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                />
                <View
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        paddingHorizontal: s(spacing.md),
                        paddingVertical: s(spacing.sm),
                        backgroundColor: "rgba(15,23,42,0.52)",
                    }}
                >
                    <Text
                        style={{
                            fontSize: fs(popular ? 16 : 14),
                            fontWeight: popular ? "700" : "600",
                            color: "#fff",
                        }}
                        allowFontScaling={false}
                    >
                        {pkg.name}
                    </Text>
                </View>
                {popular && (
                    <View
                        style={{
                            position: "absolute",
                            top: s(spacing.sm),
                            left: s(spacing.sm),
                            flexDirection: "row",
                            alignItems: "center",
                            gap: s(4),
                            backgroundColor: "rgba(217,119,6,0.92)",
                            borderRadius: s(radii.full),
                            paddingHorizontal: s(7),
                            paddingVertical: s(3),
                        }}
                    >
                        <Icon name="star" size={s(11)} color="#fff" />
                        <Text
                            style={{
                                fontSize: fs(10),
                                color: "#fff",
                                fontWeight: "700",
                            }}
                            allowFontScaling={false}
                        >
                            Most Booked
                        </Text>
                    </View>
                )}
            </View>

            <View style={{ padding: s(spacing.md) }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                    <View style={{ flex: 1 }}>
                        {pkg.included_portraits != null && (
                            <IncludeRow
                                text={`${pkg.included_portraits} portrait(s) included`}
                                s={s}
                                fs={fs}
                            />
                        )}

                        {inclusions.slice(0, 2).map((item, i) => (
                            <IncludeRow key={i} text={item} s={s} fs={fs} />
                        ))}

                        {freebies.slice(0, 1).map((f, i) => (
                            <IncludeRow
                                key={"f" + i}
                                text={"Bonus: " + f}
                                color={colors.success}
                                s={s}
                                fs={fs}
                            />
                        ))}
                    </View>

                    <View
                        style={{
                            alignItems: "flex-end",
                            marginLeft: s(spacing.md),
                            flexShrink: 0,
                        }}
                    >
                        {hasPromo(pkg) && (
                            <Text
                                style={{
                                    fontSize: fs(12),
                                    color: colors.mutedForeground,
                                    textDecorationLine: "line-through",
                                }}
                                allowFontScaling={false}
                            >
                                ₱{Number(pkg.price).toLocaleString()}
                            </Text>
                        )}

                        <Text
                            style={{
                                fontSize: fs(popular ? 22 : 19),
                                fontWeight: "700",
                                color: colors.accent,
                            }}
                            allowFontScaling={false}
                        >
                            ₱{Number(price).toLocaleString()}
                        </Text>

                        {!!pkg.promo_price_condition && (
                            <View
                                style={{
                                    backgroundColor: colors.warning,
                                    borderWidth: 1,
                                    borderColor: "#fde68a",
                                    borderRadius: s(radii.sm),
                                    paddingHorizontal: s(spacing.sm),
                                    paddingVertical: s(2),
                                    marginTop: s(4),
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: fs(11),
                                        fontWeight: "600",
                                        color: colors.warningText,
                                    }}
                                    allowFontScaling={false}
                                >
                                    {String(pkg.promo_price_condition)}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );
}
