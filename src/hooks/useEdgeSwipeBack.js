import { useMemo } from 'react';
import { PanResponder } from 'react-native';

export default function useEdgeSwipeBack(onBack) {
  return useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          gesture.x0 <= 28 &&
          gesture.dx > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 80) onBack();
        },
      }).panHandlers,
    [onBack]
  );
}
