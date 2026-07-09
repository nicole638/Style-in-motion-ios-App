import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Comment {
  id: string;
  lookId: string;
  authorName: string;
  authorEmail: string;
  text: string;
  createdAt: number;
}

interface CommentStore {
  comments: Record<string, Comment[]>; // key = lookId
  addComment: (lookId: string, authorName: string, authorEmail: string, text: string) => void;
  getComments: (lookId: string) => Comment[];
  getCommentCount: (lookId: string) => number;
  deleteComment: (lookId: string, commentId: string) => void;
}

const useCommentStore = create<CommentStore>()(
  persist(
    (set, get) => ({
      comments: {},

      addComment: (lookId, authorName, authorEmail, text) => {
        const { comments } = get();
        const existing = comments[lookId] ?? [];
        const newComment: Comment = {
          id: Date.now().toString() + Math.random().toString(36).slice(2),
          lookId,
          authorName,
          authorEmail,
          text: text.trim(),
          createdAt: Date.now(),
        };
        set({
          comments: {
            ...comments,
            [lookId]: [...existing, newComment],
          },
        });
      },

      getComments: (lookId) => {
        return get().comments[lookId] ?? [];
      },

      getCommentCount: (lookId) => {
        return (get().comments[lookId] ?? []).length;
      },

      deleteComment: (lookId, commentId) => {
        const { comments } = get();
        const existing = comments[lookId] ?? [];
        set({
          comments: {
            ...comments,
            [lookId]: existing.filter((c) => c.id !== commentId),
          },
        });
      },
    }),
    {
      name: 'comment-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ comments: state.comments }),
    }
  )
);

export default useCommentStore;
