import React from 'react';
import { View } from 'react-native';
import { BaseCanvas, BaseCanvasProps } from './canvasShared';
import { getTemplate } from '@/lib/constants/collageTemplates';

export const EditorialCanvas = React.forwardRef<View, Omit<BaseCanvasProps, 'template'>>(
  function EditorialCanvas(props, ref) {
    return (
      <BaseCanvas
        ref={ref}
        {...props}
        template={getTemplate('editorial')}
      />
    );
  }
);

export default EditorialCanvas;
