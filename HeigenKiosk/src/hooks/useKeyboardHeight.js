// src/hooks/useKeyboardHeight.js
// Height (dp) of the on-screen keyboard, 0 when hidden. Used to keep centered
// dialogs above the keyboard (edge-to-edge Android no longer resizes the window).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';
import { keyboardInset } from '../utils/keyboardInset';

export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setHeight(e?.endCoordinates?.height || 0));
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

// For a full-screen dialog host: attach onLayout to it, pad its bottom by `inset`, and
// size the dialog from `hostH`. Tallest height seen per window width = unshrunk height.
export function useKeyboardInset() {
  const keyboardH = useKeyboardHeight();
  const { width, height: windowH } = useWindowDimensions();
  const [hostH, setHostH] = useState(0);
  const fullH = useRef({ width: 0, h: 0 });

  const onLayout = useCallback(
    (e) => {
      const h = e.nativeEvent.layout.height;
      if (fullH.current.width !== width || h > fullH.current.h) fullH.current = { width, h };
      setHostH(h);
    },
    [width],
  );

  return {
    inset: keyboardInset(keyboardH, fullH.current.h, hostH),
    hostH: hostH || windowH,
    onLayout,
  };
}
