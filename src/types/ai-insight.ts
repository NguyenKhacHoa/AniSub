export interface CinemaInsightMetrics {
  plot: number;
  visuals: number;
  audio: number;
  pacing: number;
}

export interface CinemaInsightHighlight {
  time: string;
  description: string;
}

export type CommentSentiment = 'positive' | 'mixed' | 'critical';

export interface CinemaInsightFeaturedComment {
  author: string;
  text: string;
  likes: number;
  sentiment: CommentSentiment;
}

export interface CinemaInsightData {
  overallScore: number;
  verdictLabel: string;
  metrics: CinemaInsightMetrics;
  overview: string;
  highlights: CinemaInsightHighlight[];
  communityPros: string[];
  communityCons: string[];
  featuredComments: CinemaInsightFeaturedComment[];
  analyzedCommentCount: number;
  hasTranscript: boolean;
  hasComments: boolean;
  storyContext: string;
  analyzedAt: string;
}

export interface CinemaChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
