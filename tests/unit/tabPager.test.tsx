import React from 'react';
import { ScrollView, Text } from 'react-native';
import { fireEvent, isHiddenFromAccessibility, render } from '@testing-library/react-native';

import TabPager from '../../components/TabPager';

const PAGE_WIDTH = 300;

// The jest preset mocks ScrollView with one shared scrollTo on its prototype.
const scrollTo = ScrollView.prototype.scrollTo as jest.Mock;

const pages = [<Text key="sp">Silent Payments</Text>, <Text key="standard">Standard</Text>];

const renderPager = (selectedIndex: number, onChange: jest.Mock) => {
  const utils = render(
    <TabPager selectedIndex={selectedIndex} onChange={onChange} testID="pager">
      {pages}
    </TabPager>,
  );
  fireEvent(utils.getByTestId('pager'), 'layout', { nativeEvent: { layout: { width: PAGE_WIDTH, height: 600 } } });
  return utils;
};

const scrollToX = (pager: ReturnType<typeof render>, x: number) =>
  fireEvent.scroll(pager.getByTestId('pager'), { nativeEvent: { contentOffset: { x, y: 0 } } });

describe('unit - TabPager', () => {
  beforeEach(() => {
    scrollTo.mockClear();
  });

  it('reports a swipe once it is past the halfway point', () => {
    const onChange = jest.fn();
    const pager = renderPager(0, onChange);

    scrollToX(pager, PAGE_WIDTH * 0.4);
    expect(onChange).not.toHaveBeenCalled();

    scrollToX(pager, PAGE_WIDTH * 0.6);
    expect(onChange).toHaveBeenCalledWith(1);

    scrollToX(pager, PAGE_WIDTH);
    expect(onChange).toHaveBeenCalledTimes(1);

    // And back again, for a swipe that changes its mind.
    scrollToX(pager, PAGE_WIDTH * 0.4);
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('scrolls to a tapped tab without the pages it passes moving the tab back', () => {
    const onChange = jest.fn();
    const pager = renderPager(0, onChange);

    pager.rerender(
      <TabPager selectedIndex={1} onChange={onChange} testID="pager">
        {pages}
      </TabPager>,
    );
    expect(scrollTo).toHaveBeenLastCalledWith({ x: PAGE_WIDTH, animated: true });

    scrollToX(pager, PAGE_WIDTH * 0.3);
    scrollToX(pager, PAGE_WIDTH * 0.7);
    scrollToX(pager, PAGE_WIDTH);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('hands control back to the finger when a drag interrupts the scroll to a tapped tab', () => {
    const onChange = jest.fn();
    const pager = renderPager(0, onChange);

    pager.rerender(
      <TabPager selectedIndex={1} onChange={onChange} testID="pager">
        {pages}
      </TabPager>,
    );
    fireEvent(pager.getByTestId('pager'), 'scrollBeginDrag');
    scrollToX(pager, PAGE_WIDTH * 0.2);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('hides the page that is off screen from screen readers', () => {
    const onChange = jest.fn();
    const pager = renderPager(0, onChange);
    const hidden = (text: string) => isHiddenFromAccessibility(pager.getByText(text, { includeHiddenElements: true }));
    expect(hidden('Silent Payments')).toBe(false);
    expect(hidden('Standard')).toBe(true);

    pager.rerender(
      <TabPager selectedIndex={1} onChange={onChange} testID="pager">
        {pages}
      </TabPager>,
    );
    expect(hidden('Silent Payments')).toBe(true);
    expect(hidden('Standard')).toBe(false);
  });

  it('stays on its page when its width changes', () => {
    const pager = renderPager(1, jest.fn());
    expect(scrollTo).toHaveBeenLastCalledWith({ x: PAGE_WIDTH, animated: false });

    fireEvent(pager.getByTestId('pager'), 'layout', { nativeEvent: { layout: { width: 500, height: 600 } } });
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 500, animated: false });
  });
});
