/**
 * Video Cost Calculator
 * Calculates credit costs for video uploads and quiz generation
 */

/**
 * Calculate video upload cost based on duration
 * Cost: 1 credit per minute (rounded up)
 */
export function calculateVideoUploadCost(durationInSeconds: number): number {
  const minutes = Math.ceil(durationInSeconds / 60);
  return minutes; // 1 credit per minute
}

/**
 * Calculate quiz generation cost
 * 1 crédito a cada 5 perguntas (1-5 => 1, 6-10 => 2)
 */
export function calculateQuizGenerationCost(numQuestions: number = 5): number {
  return Math.max(1, Math.ceil(numQuestions / 5));
}

/**
 * Calculate AI chat cost
 * Cost: 1 credit per question
 */
export function calculateAIChatCost(): number {
  return 1;
}



