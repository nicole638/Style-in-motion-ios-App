import React from 'react';
import { View } from 'react-native';
import { BaseCanvas, BaseCanvasProps } from './canvasShared';
import { getTemplate } from '@/lib/constants/collageTemplates';

export const WhatsInMyBagCanvas = React.forwardRef<View, Omit<BaseCanvasProps, 'template'>>(
  function WhatsInMyBagCanvas(props, ref) {
    return (
      <BaseCanvas
        ref={ref}
        {...props}
        template={getTemplate('whats-in-my-bag')}
      />
    );
  }
);

export default WhatsInMyBagCanvas;
