export interface GalleryItem {
  id: string;
  imageUrl: string;
  caption: string;
  date: string;
  permalink: string;
  width?: number;
  height?: number;
}

export interface FacebookPost {
  id: string;
  message?: string;
  full_picture?: string;
  created_time: string;
  permalink_url: string;
  attachments?: {
    data: Array<{
      media?: { image: { src: string; width: number; height: number } };
      subattachments?: {
        data: Array<{
          media: { image: { src: string; width: number; height: number } };
        }>;
      };
    }>;
  };
}

export interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  type?: 'website' | 'article';
  canonicalUrl?: string;
}

export type NavItem = {
  label: string;
  href: string;
};

export type RevealDirection = 'up' | 'left' | 'right' | 'scale' | 'fade';
