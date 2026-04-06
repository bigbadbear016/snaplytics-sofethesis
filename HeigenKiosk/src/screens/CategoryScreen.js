// src/screens/CategoryScreen.js
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image } from 'react-native';
import Icon from '../components/Icon';
import { useApi } from '../hooks/useApi';
import { fetchCategories } from '../api/client';
import { LoadingScreen, ErrorScreen } from '../components/ui';
import { colors, spacing, radii, shadow } from '../constants/theme';
import { useScale } from '../hooks/useScale';
import { resolveCategoryImage } from '../constants/assets';

const SOURCE_LABELS = {
  customer_booking_history: "Booking Loyalty",
  personalized_by_pkg_pred: "For You",
  popular_fallback: "Popular Choice",
  popularity: "Popular Choice",
  popular_package_monthly: "Trending",
  popular_package_overall: "Top Booked",
};

export default function CategoryScreen({
  onSelectCategory,
  recommendationData,
  onSelectRecommendation,
}) {
  const { data: categories, loading, error, refetch } = useApi(fetchCategories);
  const { s, fs, isTablet, W } = useScale();
  const [scrollY, setScrollY] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  if (loading) return <LoadingScreen message="Loading categories..." />;
  if (error)   return <ErrorScreen message={error} onRetry={refetch} />;
  if (!categories?.length) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: fs(16), color: colors.mutedForeground }}>No categories available.</Text>
    </View>
  );

  // On tablet landscape: two-column grid; on phone: single column list
  const numCols = isTablet ? 2 : 1;
  const colGap  = s(spacing.lg);
  const hPad    = s(spacing.xl);
  const cardW   = numCols === 2 ? (W - hPad * 2 - colGap) / 2 : undefined;
  const recs = recommendationData?.recommendations ?? [];
  const hasRecs = recs.length > 0;
  const isHistoryBased = (recommendationData?.total_bookings ?? 0) > 0;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const canScrollDown = maxScroll > s(8);
  const isNearBottom = scrollY >= maxScroll - s(20);
  const showScrollHint = canScrollDown && !isNearBottom;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: hPad, paddingBottom: s(spacing.xxxl * 2) }}
        showsVerticalScrollIndicator={false}
        onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContentHeight(h)}
        onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        {hasRecs && (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: s(radii.xxl),
            borderWidth: 1,
            borderColor: colors.border,
            borderLeftWidth: s(4),
            borderLeftColor: colors.primary,
            padding: s(spacing.xl),
            marginBottom: s(spacing.xl),
            ...shadow.md,
          }}
        >
          <Text
            style={{
              fontSize: fs(11),
              fontWeight: "800",
              color: colors.primary,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: s(6),
            }}
            allowFontScaling={false}
          >
            {isHistoryBased ? "Picked for you" : "Trending"}
          </Text>
          <Text
            style={{ fontSize: fs(19), fontWeight: "700", marginBottom: s(6), color: colors.foreground }}
            allowFontScaling={false}
          >
            {isHistoryBased ? "Recommended for You" : "Popular Right Now"}
          </Text>
          <Text
            style={{ fontSize: fs(13), color: colors.mutedForeground, marginBottom: s(spacing.lg), lineHeight: fs(20) }}
            allowFontScaling={false}
          >
            {isHistoryBased
              ? "Based on your booking history. Tap a recommendation to skip straight to booking summary."
              : "New customer fallback. Tap a recommendation to book instantly, or continue by category below."}
          </Text>
          <View style={{ gap: s(spacing.md) }}>
            {recs.slice(0, 3).map((rec, idx) => (
              <RecommendationCard
                key={`${rec?.package?.id ?? idx}-${idx}`}
                rec={rec}
                onPress={() => onSelectRecommendation?.(rec)}
                s={s}
                fs={fs}
              />
            ))}
          </View>
        </View>
      )}

      <View style={{ alignItems: 'center', marginBottom: s(spacing.xxl), marginTop: s(spacing.lg), paddingHorizontal: s(spacing.sm) }}>
        <View style={{ width: s(40), height: s(4), borderRadius: s(2), backgroundColor: colors.primary, opacity: 0.85, marginBottom: s(spacing.md) }} />
        <Text
          style={{
            fontSize: fs(isTablet ? 26 : 24),
            fontWeight: '800',
            textAlign: 'center',
            color: colors.primaryDark,
            letterSpacing: 0.15,
            lineHeight: fs(isTablet ? 32 : 30),
            maxWidth: s(400),
          }}
          allowFontScaling={false}
        >
          Choose a category
        </Text>
        <Text
          style={{
            fontSize: fs(15),
            color: colors.slateDeep,
            textAlign: 'center',
            marginTop: s(10),
            lineHeight: fs(22),
            maxWidth: s(340),
            fontWeight: '500',
          }}
          allowFontScaling={false}
        >
          Select the type of session you’d like to book
        </Text>
      </View>

        {numCols === 2 ? (
        // Tablet: two-column grid
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: colGap }}>
          {categories.map((cat) => (
            <CategoryCard key={cat.id} category={cat} onPress={() => onSelectCategory(cat)} width={cardW} s={s} fs={fs} />
          ))}
        </View>
        ) : (
        // Phone: stacked list
        <View style={{ gap: s(spacing.lg) }}>
          {categories.map((cat) => (
            <CategoryCard key={cat.id} category={cat} onPress={() => onSelectCategory(cat)} s={s} fs={fs} />
          ))}
        </View>
        )}
      </ScrollView>
      {showScrollHint && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: s(spacing.xl),
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: s(34),
              height: s(34),
              borderRadius: s(17),
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.74)',
              borderWidth: 1,
              borderColor: 'rgba(0,0,0,0.08)',
              ...shadow.sm,
            }}
          >
            <Icon name="chevron-down" size={s(16)} color={colors.mutedForeground} />
          </View>
        </View>
      )}
    </View>
  );
}

function RecommendationCard({ rec, onPress, s, fs }) {
  const pkg = rec?.package;
  if (!pkg) return null;
  const addons = Array.isArray(rec?.addons) ? rec.addons : [];
  const basePrice = Number(rec?.base_price ?? pkg.promo_price ?? pkg.price ?? 0);
  const totalPrice = Number(rec?.total_price ?? basePrice);
  const sourceLabel = SOURCE_LABELS[rec?.source] || "Recommended";

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: s(radii.lg),
        backgroundColor: colors.backgroundElevated,
        padding: s(spacing.md),
        ...shadow.sm,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: s(6) }}>
        <View style={{ flex: 1, marginRight: s(spacing.sm) }}>
          <Text style={{ fontSize: fs(15), fontWeight: "700", color: colors.foreground }} allowFontScaling={false}>
            {pkg.name}
          </Text>
          <Text style={{ fontSize: fs(13), color: colors.slateDeep, marginTop: s(2), fontWeight: '600', lineHeight: fs(18) }} allowFontScaling={false}>
            {pkg.category}
          </Text>
        </View>
        <View
          style={{
            backgroundColor: colors.accentLight,
            borderRadius: s(999),
            paddingHorizontal: s(10),
            paddingVertical: s(4),
          }}
        >
          <Text style={{ fontSize: fs(10), color: colors.primary, fontWeight: "700" }} allowFontScaling={false}>
            {sourceLabel}
          </Text>
        </View>
      </View>

      {addons.length > 0 && (
        <Text
          style={{ fontSize: fs(12), color: colors.mutedForeground, marginBottom: s(8) }}
          allowFontScaling={false}
          numberOfLines={2}
        >
          Add-ons: {addons.map((a) => a.name).join(", ")}
        </Text>
      )}

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: fs(14), color: colors.primary, fontWeight: "700" }} allowFontScaling={false}>
          Total: ₱{totalPrice.toLocaleString()}
        </Text>
        <Text style={{ fontSize: fs(12), color: colors.mutedForeground }} allowFontScaling={false}>
          Base ₱{basePrice.toLocaleString()}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function CategoryCard({ category, onPress, width, s, fs }) {
  const { isTablet } = useScale();
  const iconSize = s(72);
  const imageSource = resolveCategoryImage(category);

  return (
    <TouchableOpacity
      onPress={onPress} activeOpacity={0.88}
      style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.card, borderRadius: s(radii.xxl),
        borderWidth: 1, borderColor: colors.border,
        padding: s(spacing.xl), gap: s(spacing.lg), ...shadow.md,
        width: width || undefined,
      }}
    >
      <View style={{
        width: iconSize, height: iconSize, borderRadius: s(radii.xl),
        overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors.muted, flexShrink: 0,
        borderWidth: 1, borderColor: colors.border,
      }}>
        <Image
          source={{ uri: imageSource }}
          style={{ width: iconSize, height: iconSize }}
          resizeMode="cover"
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontSize: fs(isTablet ? 19 : 18),
            fontWeight: '700',
            marginBottom: s(6),
            color: colors.foreground,
            lineHeight: fs(24),
            letterSpacing: 0.1,
          }}
          allowFontScaling={false}
          numberOfLines={2}
        >
          {category.name}
        </Text>
        <Text
          style={{
            fontSize: fs(15),
            color: colors.slateDeep,
            lineHeight: fs(22),
            fontWeight: '500',
          }}
          allowFontScaling={false}
          numberOfLines={3}
        >
          {category.description || 'Professional photography session'}
        </Text>
      </View>
      <View style={{
        width: s(40), height: s(40), borderRadius: s(20),
        backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        borderWidth: 1, borderColor: 'rgba(22, 81, 102, 0.12)',
      }}>
        <Icon name="chevron-forward" size={s(20)} color={colors.primary} />
      </View>
    </TouchableOpacity>
  );
}
