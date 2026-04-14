// src/screens/PackageScreen.js
import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Image } from "react-native";
import Icon from "../components/Icon";
import { useApi } from "../hooks/useApi";
import {
    fetchPackages,
    fetchPopularPackage,
    snapshotPackagesForCategory,
    snapshotPopularPackage,
} from "../api/client";
import { LoadingScreen, ErrorScreen, Button } from "../components/ui";
import { colors, spacing, radii, shadow } from "../constants/theme";
import { useScale } from "../hooks/useScale";
import { resolvePackageImage } from "../constants/assets";
import {
    parseStringArrayField,
    formatPortraitIncludedLine,
} from "../utils/packageFieldParse";

export default function PackageScreen({ category, onSelectPackage, onBack, kioskSnapshot = null }) {
    const { s, fs, isTablet, W } = useScale();
    const [scrollY, setScrollY] = useState(0);
    const [contentHeight, setContentHeight] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const catName = category?.name;
    const fetchPackagesAndPopular = useCallback(async () => {
        const [pkgs, pop] = await Promise.all([
            fetchPackages(catName),
            fetchPopularPackage(catName),
        ]);
        return { pkgs, pop };
    }, [catName]);

    const useSnapshot = !!kioskSnapshot;
    const { data: bundle, loading, error, refetch } = useApi(
        fetchPackagesAndPopular,
        [],
        { enabled: !useSnapshot },
    );
    const packages = useSnapshot
        ? snapshotPackagesForCategory(kioskSnapshot, catName)
        : bundle?.pkgs;
    const popularData = useSnapshot
        ? snapshotPopularPackage(kioskSnapshot, catName)
        : bundle?.pop;

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
                    Select a package
                </Text>
                <Text
                    style={{
                        fontSize: fs(14),
                        color: colors.mutedForeground,
                        textAlign: "center",
                        marginTop: s(6),
                    }}
                    allowFontScaling={false}
                >
                    for {catName}
                </Text>
            </View>

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

function hasPromo(pkg) {
    return pkg.promo_price != null && Number(pkg.promo_price) > 0;
}

/** Single currency label everywhere (avoid mixing "PHP" in artwork vs ₱ in UI). */
function formatPeso(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "—";
    return `₱${n.toLocaleString()}`;
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

// Same image height + bar layout for every card so side-by-side rows align.
// Authoritative price on the teal bar (API) so it always matches the body (fixes baked "PHP" on artwork).
function PackageCard({ pkg, onPress, popular = false, s, fs, width }) {
    const borderColor = popular ? colors.primary : colors.border;
    const bgColor = colors.card;
    const listPrice = pkg.price;
    const effectivePrice = hasPromo(pkg) ? pkg.promo_price : pkg.price;
    const inclusions = parseStringArrayField(pkg.inclusions) ?? [];
    const freebies = parseStringArrayField(pkg.freebies) ?? [];
    const portraitLine = formatPortraitIncludedLine(pkg.included_portraits);
    const packageImage = resolvePackageImage(pkg);
    const imageHeight = s(168);
    const barPadH = s(spacing.lg);
    const barMinH = s(48);

    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.85}
            style={{
                borderRadius: s(radii.xl),
                borderWidth: 1,
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
                {/* Reserve top band so “Most Booked” vs no badge keeps similar vertical rhythm */}
                <View
                    style={{
                        position: "absolute",
                        top: s(spacing.sm),
                        left: s(spacing.sm),
                        right: s(spacing.sm),
                        minHeight: s(28),
                        zIndex: 2,
                        justifyContent: "center",
                    }}
                >
                    {popular ? (
                        <View
                            style={{
                                alignSelf: "flex-start",
                                flexDirection: "row",
                                alignItems: "center",
                                gap: s(4),
                                backgroundColor: "rgba(22,81,102,0.95)",
                                borderRadius: s(radii.full),
                                paddingHorizontal: s(8),
                                paddingVertical: s(4),
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
                    ) : null}
                </View>
                <View
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        minHeight: barMinH,
                        paddingHorizontal: barPadH,
                        paddingVertical: s(spacing.sm),
                        justifyContent: "center",
                        backgroundColor: "rgba(19, 65, 82, 0.88)",
                    }}
                >
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: s(spacing.sm),
                        }}
                    >
                        <Text
                            style={{
                                flex: 1,
                                fontSize: fs(15),
                                fontWeight: "700",
                                color: "#fff",
                                lineHeight: fs(20),
                            }}
                            allowFontScaling={false}
                            numberOfLines={2}
                            ellipsizeMode="tail"
                        >
                            {pkg.name}
                        </Text>
                        <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
                            {hasPromo(pkg) && (
                                <Text
                                    style={{
                                        fontSize: fs(11),
                                        color: "rgba(255,255,255,0.65)",
                                        textDecorationLine: "line-through",
                                        marginBottom: s(2),
                                    }}
                                    allowFontScaling={false}
                                >
                                    {formatPeso(listPrice)}
                                </Text>
                            )}
                            <Text
                                style={{
                                    fontSize: fs(16),
                                    fontWeight: "800",
                                    color: "#fff",
                                    letterSpacing: 0.2,
                                }}
                                allowFontScaling={false}
                            >
                                {formatPeso(effectivePrice)}
                            </Text>
                        </View>
                    </View>
                </View>
            </View>

            <View style={{ padding: s(spacing.md) }}>
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                    }}
                >
                    <View
                        style={{
                            flex: 1,
                            minHeight: s(76),
                            paddingTop: 0,
                        }}
                    >
                        {portraitLine != null && (
                            <IncludeRow
                                text={portraitLine}
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
                            minWidth: s(88),
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
                                {formatPeso(listPrice)}
                            </Text>
                        )}

                        <Text
                            style={{
                                fontSize: fs(20),
                                fontWeight: "700",
                                color: colors.accent,
                            }}
                            allowFontScaling={false}
                        >
                            {formatPeso(effectivePrice)}
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
