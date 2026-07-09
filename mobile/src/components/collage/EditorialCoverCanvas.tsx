import React from 'react';
import { View } from 'react-native';
import { BaseCanvas, BaseCanvasProps } from './canvasShared';
import { getTemplate } from '@/lib/constants/collageTemplates';

export const EditorialCoverCanvas = React.forwardRef<View, Omit<BaseCanvasProps, 'template'>>(
  function EditorialCoverCanvas(props, ref) {
    return (
      <BaseCanvas
        ref={ref}
        {...props}
        template={getTemplate('editorial-cover')}
      />
    );
  }
);

export default EditorialCoverCanvas;
