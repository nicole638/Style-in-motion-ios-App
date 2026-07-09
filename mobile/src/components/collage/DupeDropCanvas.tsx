import React from 'react';
import { View } from 'react-native';
import { BaseCanvas, BaseCanvasProps } from './canvasShared';
import { getTemplate } from '@/lib/constants/collageTemplates';

export const DupeDropCanvas = React.forwardRef<View, Omit<BaseCanvasProps, 'template'>>(
  function DupeDropCanvas(props, ref) {
    return (
      <BaseCanvas
        ref={ref}
        {...props}
        template={getTemplate('dupe-drop')}
      />
    );
  }
);

export default DupeDropCanvas;
