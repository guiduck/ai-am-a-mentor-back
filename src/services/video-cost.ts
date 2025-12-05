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
 * Fixed cost: 5 credits per quiz
 */
export function calculateQuizGenerationCost(): number {
  return 5;
}

/**
 * Calculate AI chat cost
 * Cost: 1 credit per question
 */
export function calculateAIChatCost(): number {
  return 1;
}





