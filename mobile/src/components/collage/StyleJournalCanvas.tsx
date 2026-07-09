import React from 'react';
import { View } from 'react-native';
import { BaseCanvas, BaseCanvasProps } from './canvasShared';
import { getTemplate } from '@/lib/constants/collageTemplates';

export const StyleJournalCanvas = React.forwardRef<View, Omit<BaseCanvasProps, 'template'>>(
  function StyleJournalCanvas(props, ref) {
    return (
      <BaseCanvas
        ref={ref}
        {...props}
        template={getTemplate('style-journal')}
      />
    );
  }
);

export default StyleJournalCanvas;
