import React from 'react';
import { View } from 'react-native';
import { BaseCanvas, BaseCanvasProps } from './canvasShared';
import { getTemplate } from '@/lib/constants/collageTemplates';

export const GridCanvas = React.forwardRef<View, Omit<BaseCanvasProps, 'template'>>(
  function GridCanvas(props, ref) {
    return (
      <BaseCanvas
        ref={ref}
        {...props}
        template={getTemplate('grid')}
      />
    );
  }
);

export default GridCanvas;
