import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ArrowRight, Calculator, Check, ClipboardList, Home, Ruler, Scale, TrendingDown } from 'lucide-react-native';
import { T } from '../src/ui/Text';
import { Brand } from '../src/ui/Mark';
import { font } from '../src/theme/tokens';
import { IMAGES, type ImageKey } from '../src/assets/images';
import { BudgetPreview, ChainPreview, ComparePreview, FinishPreview, RoomPreview, usePlayOnce } from '../src/discover/Previews';

/**
 * The value pitch, shown to EVERY signed-out visitor (blueprint B1, BRD §5.1).
 *
 * A real pager: a horizontal ScrollView with `pagingEnabled`, every slide
 * mounted, the index from the scroll position, so a swipe never blinks while
 * a photo decodes. Each slide: a cinematic photo over the top ~56% fading into
 * espresso ink, a live sample card riding the photo's lower edge (plays ONCE;
 * Reduce Motion shows the final state), an eyebrow chip, a serif headline and
 * at most two lines of body.
 *
 * Honest: every figure is labelled Sample, and the paid model is stated
 * before sign-up ("Subscription required. No free trial.", BRD §1.3).
 * `?slide=N` (1-based) opens a given slide for store screenshots and the harness.
 */

const INK = '#1F1611';
const CREAM = '#FBF4EA';
const MUTED = '#C9B6A4';
const MINT = '#F5A270';

type Slide = { key: string; image: ImageKey; chip: string; icon: (c: string) => React.ReactNode; headline: string; sub: string; note?: string };

const SLIDES: Slide[] = [
  { key: 'budget', image: 'discover-budget', chip: 'Every category', icon: (c) => <Home size={14} color={c} />, headline: 'Plan the full\nhouse budget', sub: 'Land to landscaping, nothing quietly left out. Unknown costs stay visible, never zero.' },
  { key: 'compare', image: 'discover-compare', chip: 'Before you buy', icon: (c) => <Scale size={14} color={c} />, headline: 'Compare materials\nbefore buying', sub: 'See what a different floor, tile or window really changes, on your own rooms.' },
  {
    key: 'finish',
    image: 'discover-progress',
    chip: 'While you build',
    icon: (c) => <TrendingDown size={14} color={c} />,
    headline: 'Know the cost\nto finish',
    sub: 'Billed, committed and still to buy, against what you have paid.',
  },
  { key: 'quotes', image: 'discover-quotes', chip: 'Kept apart', icon: (c) => <ClipboardList size={14} color={c} />, headline: 'Quotes, invoices\nand payments', sub: 'Planned, ordered, billed and paid each in their place, so nothing counts twice.' },
  { key: 'rooms', image: 'discover-rooms', chip: 'Measure once', icon: (c) => <Ruler size={14} color={c} />, headline: 'Rooms that\nprice themselves', sub: 'Packs of flooring, cans of paint, lengths of skirting, from your measurements.' },
];
const CLOSING: Slide = {
  key: 'start',
  image: 'discover-finish',
  chip: 'HousePlan subscription',
  icon: (c) => <Calculator size={14} color={c} />,
  headline: 'What you get',
  sub: 'All of it, for every house project you run.',
  note: 'Subscription required. No free trial.',
};
const ALL = [...SLIDES, CLOSING];
const LAST = ALL.length - 1;

export default function Discover() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slide?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const initial = Math.min(LAST, Math.max(0, Number(params.slide ?? '1') - 1 || 0));
  const [index, setIndex] = useState(initial);
  const [reduce, setReduce] = useState(false);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([initial]));
  // Until the pager has scrolled to ?slide=N, its first scroll events report x=0: ignore them.
  const positioned = useRef(initial === 0);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => undefined);
  }, []);

  const settle = (i: number) => {
    if (i === index) return;
    setIndex(i);
    setVisited((v) => (v.has(i) ? v : new Set(v).add(i)));
    void Haptics.selectionAsync().catch(() => undefined);
  };

  const goTo = (i: number) => {
    const next = Math.min(LAST, Math.max(0, i));
    pager.current?.scrollTo({ x: next * width, animated: !reduce });
    if (reduce) settle(next);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (!positioned.current) {
      if (i !== initial) return;
      positioned.current = true;
    }
    if (i >= 0 && i <= LAST && i !== index) settle(i);
  };

  const photoH = Math.round(height * 0.56);
  const last = index === LAST;
  const dots = (
    <View style={{ flexDirection: 'row', gap: 7 }} accessibilityRole="adjustable" accessibilityLabel={`Slide ${index + 1} of ${ALL.length}`}>
      {ALL.map((s, i) => (
        <View key={s.key} style={{ width: i === index ? 22 : 7, height: 7, borderRadius: 4, backgroundColor: i === index ? MINT : 'rgba(251,244,234,0.28)' }} />
      ))}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: INK }} testID="discover">
      <StatusBar style="light" />
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        contentOffset={{ x: initial * width, y: 0 }}
        onLayout={() => initial > 0 && pager.current?.scrollTo({ x: initial * width, animated: false })}
        testID="discover-pager"
      >
        {ALL.map((s, i) => (
          <SlideView key={s.key} slide={s} i={i} width={width} height={height} photoH={photoH} topInset={insets.top} bottomInset={insets.bottom} active={visited.has(i)} reduce={reduce} />
        ))}
      </ScrollView>

      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 10, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Brand tone="light" size={26} />
        <View style={{ flexDirection: 'row', gap: 20, alignItems: 'center' }}>
          {!last ? (
            <T style={{ fontFamily: font.semibold, fontSize: 14.5, color: '#FFFFFF' }} onPress={() => goTo(LAST)} accessibilityRole="button" suppressHighlighting testID="discover-skip">
              Skip
            </T>
          ) : null}
          <T style={{ fontFamily: font.semibold, fontSize: 14.5, color: '#FFFFFF' }} onPress={() => router.push('/sign-in')} accessibilityRole="button" testID="discover-signin" suppressHighlighting>
            Sign in
          </T>
        </View>
      </View>

      <View style={{ position: 'absolute', left: 20, right: 20, bottom: insets.bottom + 14, gap: 14 }}>
        {last ? (
          <>
            <View style={{ alignItems: 'center' }}>{dots}</View>
            <Pressable
              onPress={() => router.push('/register')}
              accessibilityRole="button"
              testID="discover-start"
              style={({ pressed }) => ({ height: 58, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.9 : 1 })}
            >
              <T style={{ fontFamily: font.semibold, fontSize: 17, color: INK }}>Get started</T>
            </Pressable>
            <T style={{ fontFamily: font.semibold, fontSize: 15, color: CREAM, textAlign: 'center', paddingVertical: 4 }} onPress={() => router.push('/sign-in')} accessibilityRole="button" suppressHighlighting>
              I already have an account
            </T>
          </>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {dots}
            <Pressable
              onPress={() => goTo(index + 1)}
              accessibilityRole="button"
              accessibilityLabel="Next"
              testID="discover-next"
              style={({ pressed }) => ({ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}
            >
              <ArrowRight size={24} color={INK} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function SlideView({ slide, i, width, height, photoH, topInset, bottomInset, active, reduce }: { slide: Slide; i: number; width: number; height: number; photoH: number; topInset: number; bottomInset: number; active: boolean; reduce: boolean }) {
  const t = usePlayOnce(active, reduce);
  const closing = slide.key === 'start';
  const card = [<BudgetPreview key="b" t={t} />, <ComparePreview key="c" t={t} />, <FinishPreview key="f" t={t} />, <ChainPreview key="q" t={t} />, <RoomPreview key="r" t={t} />][i];
  const cardTop = Math.max(topInset + 64, photoH - (height < 760 ? 200 : 160));
  return (
    <View style={{ width, height, backgroundColor: INK }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: photoH }}>
        <Image source={IMAGES[slide.image]} style={{ width: '100%', height: '100%' }} contentFit="cover" contentPosition={{ top: '20%', left: '50%' }} transition={0} />
        <LinearGradient colors={['rgba(31,22,17,0.6)', 'rgba(31,22,17,0)', 'rgba(31,22,17,0.15)', INK]} locations={[0, 0.24, 0.6, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      </View>
      <View style={[{ position: 'absolute', left: 20, right: 20, gap: 14 }, closing ? { bottom: bottomInset + CLOSING_CONTROLS } : { top: cardTop }]}>
        {closing ? <IncludedCard /> : card}
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(245,162,112,0.12)', borderWidth: 1, borderColor: 'rgba(245,162,112,0.3)' }}>
            {slide.icon(MINT)}
            <T style={{ fontFamily: font.semibold, fontSize: 12.5, color: MINT }}>{slide.chip}</T>
          </View>
        </View>
        <T style={{ fontFamily: font.display, fontSize: 36, lineHeight: 40, letterSpacing: -0.6, color: CREAM }} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          {slide.headline}
        </T>
        <T style={{ fontFamily: font.body, fontSize: 15.5, lineHeight: 22, color: MUTED, marginTop: -4 }} numberOfLines={2} maxFontSizeMultiplier={1.4}>
          {slide.sub}
        </T>
        {slide.note || slide.key === 'finish' ? (
          <T style={{ fontFamily: font.semibold, fontSize: 13, color: MINT }}>{slide.note ?? 'Subscription required. No free trial.'}</T>
        ) : null}
      </View>
    </View>
  );
}

/** Height of the closing slide's controls (dots, Get started, a link) plus breathing room. */
const CLOSING_CONTROLS = 150;

/** What the subscription includes, in plain words (BRD §2.2). */
function IncludedCard() {
  const row = (text: string) => (
    <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(245,162,112,0.16)', alignItems: 'center', justifyContent: 'center' }}>
        <Check size={15} color={MINT} strokeWidth={2.6} />
      </View>
      <T style={{ fontFamily: font.medium, fontSize: 14.5, color: CREAM, flex: 1 }}>{text}</T>
    </View>
  );
  return (
    <View style={{ backgroundColor: 'rgba(42,30,23,0.94)', borderRadius: 22, padding: 18, gap: 12, borderWidth: 1, borderColor: 'rgba(245,162,112,0.3)' }}>
      {row('A whole-house budget, every category')}
      {row('Flooring, paint, tile and skirting maths')}
      {row('Saved revisions and side-by-side choices')}
      {row('Quotes, invoices, payments, cost to finish')}
      {row('PDF and spreadsheet exports')}
    </View>
  );
}
