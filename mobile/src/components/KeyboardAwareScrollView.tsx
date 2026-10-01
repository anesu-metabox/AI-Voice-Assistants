import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  KeyboardEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  ScrollViewProps,
  TextInput,
} from 'react-native';

/**
 * Drop-in replacement for <ScrollView> on screens with text inputs.
 *
 * - Adds blank space at the bottom equal to the keyboard height so you can
 *   always scroll far enough.
 * - When a text box gets focus (or you tap a different one while the keyboard
 *   is already open) it scrolls automatically so the box sits just above the
 *   keyboard and you can see what you type.
 *
 * Works on Android (including edge-to-edge) and iOS, and needs no changes to
 * the individual TextInputs.
 */
const EXTRA_SPACE = 24; // breathing room between the text box and the keyboard

const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ children, contentContainerStyle, onScroll, ...rest }, ref) => {
    const scrollRef = useRef<ScrollView>(null);
    const scrollY = useRef(0);
    const keyboardTop = useRef<number | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [keyboardHeight, setKeyboardHeight] = useState(0);

    useImperativeHandle(ref, () => scrollRef.current as ScrollView);

    const scrollFocusedInputIntoView = useCallback(() => {
      const input: any = (TextInput as any).State?.currentlyFocusedInput?.();
      const kbTop = keyboardTop.current;
      if (!input || kbTop == null || typeof input.measureInWindow !== 'function') return;

      input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
        const inputBottom = y + h + EXTRA_SPACE;
        const overlap = inputBottom - kbTop;
        if (overlap > 0) {
          // Text box is hidden behind the keyboard: scroll down
          scrollRef.current?.scrollTo({ y: scrollY.current + overlap, animated: true });
        } else {
          // Text box is above the visible area (e.g. under the header): scroll up
          const minTop = Dimensions.get('window').height * 0.12;
          if (y < minTop) {
            scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current - (minTop - y)), animated: true });
          }
        }
      });
    }, []);

    const scheduleScroll = useCallback(
      (delay: number) => {
        if (timer.current) clearTimeout(timer.current);
        // wait for the bottom padding to render before scrolling
        timer.current = setTimeout(scrollFocusedInputIntoView, delay);
      },
      [scrollFocusedInputIntoView]
    );

    useEffect(() => {
      const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

      const showSub = Keyboard.addListener(showEvent, (e: KeyboardEvent) => {
        keyboardTop.current = e.endCoordinates.screenY;
        setKeyboardHeight(e.endCoordinates.height);
        scheduleScroll(Platform.OS === 'ios' ? 50 : 120);
      });
      const hideSub = Keyboard.addListener(hideEvent, () => {
        keyboardTop.current = null;
        setKeyboardHeight(0);
      });
      return () => {
        showSub.remove();
        hideSub.remove();
        if (timer.current) clearTimeout(timer.current);
      };
    }, [scheduleScroll]);

    const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
      onScroll?.(e);
    };

    return (
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        scrollEventThrottle={16}
        {...rest}
        onScroll={handleScroll}
        // Tapping another text box while the keyboard is already open: re-check position
        onTouchEndCapture={(e) => {
          rest.onTouchEndCapture?.(e);
          if (keyboardTop.current != null) scheduleScroll(180);
        }}
        contentContainerStyle={[
          contentContainerStyle,
          keyboardHeight > 0 ? { paddingBottom: keyboardHeight + EXTRA_SPACE } : null,
        ]}
      >
        {children}
      </ScrollView>
    );
  }
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';
export default KeyboardAwareScrollView;
