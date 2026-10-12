import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView, View } from 'react-native';

interface TabPagerProps {
  /** One page per tab, in tab order. */
  children: React.ReactNode[];
  selectedIndex: number;
  /** Called when a swipe brings another page into view. */
  onChange: (index: number) => void;
  testID?: string;
}

// Full-width pages for a set of tabs that the user can also swipe between. Pairs with a tab
// control: tapping a tab scrolls here, and a swipe reports the new tab back once it is more than
// halfway across, so the control moves with the finger rather than after the page settles.
const TabPager: React.FC<TabPagerProps> = ({ children, selectedIndex, onChange, testID }) => {
  const scrollRef = useRef<ScrollView>(null);
  // Starts at the window width so the first frame isn't blank; onLayout corrects it in a sheet.
  const [pageWidth, setPageWidth] = useState(() => Dimensions.get('window').width);
  // The page on screen, or the one a tapped tab is scrolling to.
  const shownIndexRef = useRef(selectedIndex);
  // Set while scrolling to a tapped tab, so the pages passed on the way don't report themselves.
  const scrollTargetRef = useRef<number | null>(null);

  useEffect(() => {
    if (selectedIndex === shownIndexRef.current) return;
    shownIndexRef.current = selectedIndex;
    scrollTargetRef.current = selectedIndex;
    scrollRef.current?.scrollTo({ x: selectedIndex * pageWidth, animated: true });
  }, [selectedIndex, pageWidth]);

  // Pages are as wide as the pager, so a new width moves every page boundary.
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: shownIndexRef.current * pageWidth, animated: false });
  }, [pageWidth]);

  const onLayout = (e: LayoutChangeEvent) => setPageWidth(e.nativeEvent.layout.width);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageWidth === 0) return;
    const index = Math.min(Math.max(Math.round(e.nativeEvent.contentOffset.x / pageWidth), 0), children.length - 1);
    if (scrollTargetRef.current !== null) {
      if (index !== scrollTargetRef.current) return;
      scrollTargetRef.current = null;
    }
    if (index === shownIndexRef.current) return;
    shownIndexRef.current = index;
    onChange(index);
  };

  const onScrollBeginDrag = () => {
    scrollTargetRef.current = null;
  };

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onLayout={onLayout}
      onScroll={onScroll}
      onScrollBeginDrag={onScrollBeginDrag}
      scrollEventThrottle={16}
      testID={testID}
    >
      {children.map((page, index) => {
        // Every page stays mounted, so the ones off screen must be hidden from screen readers.
        const offScreen = index !== selectedIndex;
        return (
          <View
            key={index}
            style={{ width: pageWidth }}
            accessibilityElementsHidden={offScreen}
            importantForAccessibility={offScreen ? 'no-hide-descendants' : 'auto'}
          >
            {page}
          </View>
        );
      })}
    </ScrollView>
  );
};

export default TabPager;
