// src/screens/CategoryScreen.js
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image } from 'react-native';
import Icon from '../components/Icon';
import { useApi } from '../hooks/useApi';
import { fetchCategories } from '../api/client';
import { LoadingScreen, ErrorScreen } from '../components/ui';
import { colors, spacing, radii, typography, shadow } from '../constants/theme';
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
            borderRadius: s(radii.xl),
            borderWidth: 1.5,
            borderColor: colors.borderStrong,
            padding: s(spacing.lg),
            marginBottom: s(spacing.xl),
            ...shadow.md,
          }}
        >
          <Text
            style={{ fontSize: fs(18), fontWeight: "700", marginBottom: s(4) }}
            allowFontScaling={false}
          >
            {isHistoryBased ? "Recommended for You" : "Popular Right Now"}
          </Text>
          <Text
            style={{ fontSize: fs(13), color: colors.mutedForeground, marginBottom: s(spacing.md) }}
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

      <Text style={{ fontSize: fs(typography.h2.fontSize), fontWeight: '700', textAlign: 'center', marginBottom: s(spacing.xxl), marginTop: s(spacing.md) }}
        allowFontScaling={false}>Choose a Photoshoot Category</Text>

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
        borderWidth: 1.5,
        borderColor: colors.borderStrong,
        borderRadius: s(radii.lg),
        backgroundColor: colors.backgroundElevated,
        padding: s(spacing.md),
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: s(6) }}>
        <View style={{ flex: 1, marginRight: s(spacing.sm) }}>
          <Text style={{ fontSize: fs(15), fontWeight: "700", color: colors.foreground }} allowFontScaling={false}>
            {pkg.name}
          </Text>
          <Text style={{ fontSize: fs(12), color: colors.mutedForeground, marginTop: 1 }} allowFontScaling={false}>
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
  const iconSize = s(72);
  const imageSource = resolveCategoryImage(category);

  return (
    <TouchableOpacity
      onPress={onPress} activeOpacity={0.8}
      style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.card, borderRadius: s(radii.xxl),
        borderWidth: 2, borderColor: colors.border,
        padding: s(spacing.xl), gap: s(spacing.lg), ...shadow.md,
        width: width || undefined,
      }}
    >
      <View style={{
        width: iconSize, height: iconSize, borderRadius: s(radii.xl),
        overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors.muted, flexShrink: 0,
      }}>
        <Image
          source={{ uri: imageSource }}
          style={{ width: iconSize, height: iconSize }}
          resizeMode="cover"
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: fs(typography.h4.fontSize), fontWeight: '600', marginBottom: s(4) }}
          allowFontScaling={false}>{category.name}</Text>
        <Text style={{ fontSize: fs(typography.sm.fontSize), color: colors.mutedForeground }}
          allowFontScaling={false}>{category.description || 'Professional photography session'}</Text>
      </View>
      <View style={{
        width: s(36), height: s(36), borderRadius: s(18),
        backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon name="chevron-forward" size={s(20)} color={colors.primary} />
      </View>
    </TouchableOpacity>
  );
}
