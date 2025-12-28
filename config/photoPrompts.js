/**
 * Per-photo custom prompts for better AI generation results
 *
 * Based on Google's Gemini 2.5 Flash prompting guide:
 * - Use narrative/storytelling approach, not keyword lists
 * - Be explicit about who/what is being replaced
 * - Use photographic language (lighting, lens, composition)
 * - Describe the final scene you want positively
 *
 * Sources:
 * - https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/
 * - https://ai.google.dev/gemini-api/docs/image-generation
 */

const photoPrompts = {
  // ============================================
  // Bill Clinton & Epstein in silk shirts
  // Orange curtains, flash photography, formal event
  // ============================================
  'epstein_bill_silk.jpg': `Create a new composite image by combining elements from both provided images.

TASK: Replace Bill Clinton (the man on the LEFT with gray hair wearing a light blue patterned silk shirt) with the person from the second image. Keep Jeffrey Epstein (the man on the RIGHT with dark curly hair wearing a geometric patterned shirt) exactly as he appears.

FACE PRESERVATION - CRITICAL:
The replacement person's face must be kept 100% identical to the second image. Preserve every facial feature exactly: face shape, eye spacing, nose structure, jawline, skin tone, and all distinctive characteristics. Do not alter, age, smooth, or modify any facial features.

CLOTHING TRANSFORMATION:
Dress the replacement person in a patterned silk shirt similar in style to Clinton's original shirt - light colored with an ornate pattern. The shirt should look natural and period-appropriate for a late 1990s/early 2000s formal social gathering.

LIGHTING & STYLE MATCHING:
This is flash photography at an indoor event. Apply the same warm, flash-lit appearance with slight overexposure on faces. Match the orange/amber color cast from the curtained background. Add subtle film grain consistent with early 2000s digital photography.

COMPOSITION:
Position the replacement person at the same scale and angle as Clinton, maintaining the friendly side-by-side pose with Epstein. The two should appear as comfortable acquaintances at a social event.

Generate a photorealistic composite that looks like an authentic photograph from this moment.`,

  // ============================================
  // Noam Chomsky & Epstein on airplane
  // Private jet interior, casual setting
  // ============================================
  'epstein_chomsky_airplane.webp': `Create a new composite image by combining elements from both provided images.

TASK: Replace Noam Chomsky (the elderly man with white hair and glasses) with the person from the second image. Keep Jeffrey Epstein exactly as he appears in the airplane scene.

FACE PRESERVATION - CRITICAL:
The replacement person's face must be kept 100% identical to the second image. Preserve every facial feature exactly: face shape, eye spacing, nose structure, jawline, skin tone, and all distinctive characteristics. Do not alter, age, smooth, or modify any facial features.

SETTING CONTEXT:
This is inside a private aircraft cabin. The lighting is soft and diffused from aircraft windows. Maintain the casual, in-flight atmosphere of the original photograph.

CLOTHING:
Dress the replacement person in casual but upscale attire appropriate for private jet travel - a collared shirt or smart casual outfit that fits the wealthy traveler aesthetic.

LIGHTING & STYLE:
Match the soft, even lighting typical of aircraft interiors. The color temperature should be slightly cool/neutral. Preserve the slightly compressed dynamic range typical of candid travel photography.

COMPOSITION:
Position the replacement person naturally within the aircraft cabin scene, maintaining appropriate scale relative to Epstein and the cabin interior. The pose should look relaxed and candid, as if captured during casual conversation.

Generate a photorealistic composite that looks like an authentic candid photograph taken during flight.`,

  // ============================================
  // Woody Allen & Epstein - Heavy hooded coat
  // Doorway/entrance setting
  // ============================================
  'epstein_woodyallen_coat.png': `Create a new composite image by combining elements from both provided images.

TASK: Replace Woody Allen (the person in the CENTER wearing a light gray hooded parka coat with the hood up and round glasses) with the person from the second image. Keep Jeffrey Epstein (the man on the RIGHT in the navy blue polo shirt and jeans) exactly as he appears. Keep the partially visible man on the left unchanged.

FACE PRESERVATION - CRITICAL:
The replacement person's face must be kept 100% identical to the second image. Preserve every facial feature exactly: face shape, eye spacing, nose structure, jawline, skin tone, and all distinctive characteristics. Do not alter, age, smooth, or modify any facial features.

CLOTHING TRANSFORMATION - IMPORTANT:
Dress the replacement person in the SAME hooded parka coat as Woody Allen - a light gray/beige puffy winter jacket with the hood pulled up over their head. The coat should frame their face naturally. Keep their glasses if they have them, or add round glasses similar to Woody Allen's style. The person should have their hands in their pockets or at their sides in a similar relaxed pose.

SETTING CONTEXT:
This is at a doorway or building entrance with a red door visible on the left and stone/marble walls. The lighting is natural daylight, slightly overcast.

LIGHTING & STYLE:
Match the soft, diffused natural daylight. The color temperature is neutral to slightly cool. Preserve the casual snapshot quality of the original photograph.

COMPOSITION:
Position the replacement person at the exact same location and scale as Woody Allen, with Epstein's arm around their shoulder in the same friendly pose. The body language should remain casual and comfortable.

Generate a photorealistic composite that looks like an authentic candid photograph.`,

  // ============================================
  // Donald Trump & Epstein with women (DISABLED - safety filter issues)
  // Party/event setting
  // ============================================
  'epstein_trump_girls.webp': `Create a new composite image by combining elements from both provided images.

TASK: Replace Donald Trump (the man with blonde/orange hair in a dark suit) with the person from the second image. Keep Jeffrey Epstein and all other people in the scene exactly as they appear.

FACE PRESERVATION - CRITICAL:
The replacement person's face must be kept 100% identical to the second image. Preserve every facial feature exactly: face shape, eye spacing, nose structure, jawline, skin tone, and all distinctive characteristics. Do not alter, age, smooth, or modify any facial features.

SETTING CONTEXT:
This appears to be a social event or party setting from the late 1990s/early 2000s. Maintain the party atmosphere and all background elements.

CLOTHING:
Dress the replacement person in formal party attire - a dark suit with tie, similar to Trump's original outfit. The clothing should look natural for an upscale social gathering of that era.

LIGHTING & STYLE:
This is event photography with flash. Apply the characteristic flash-lit look with slightly harsh shadows and bright highlights on faces. Match the warm color temperature typical of indoor event photography. Add subtle noise/grain consistent with late 90s/early 2000s photography.

COMPOSITION:
Position the replacement person at the exact same location and scale as Trump in the original. Maintain natural body language and positioning relative to the other people in the frame. The group dynamic should remain intact.

Generate a photorealistic composite that looks like an authentic party photograph from this era.`,

  // ============================================
  // Default prompt for photos without custom prompts
  // ============================================
  '_default': `Create a new composite image by combining elements from both provided images.

TASK: Replace one of the people standing with Jeffrey Epstein (NOT Epstein himself) with the person from the second image.

FACE PRESERVATION - CRITICAL:
The replacement person's face must be kept 100% identical to the second image. Preserve every facial feature exactly: face shape, eye spacing, nose structure, jawline, skin tone, and all distinctive characteristics. Do not alter, age, smooth, or modify any facial features.

STYLE MATCHING:
Study the first image carefully. Match the exact lighting direction, color temperature, and shadow characteristics. If the original has warm tones, the replacement person must have warm tones. Match any film grain or digital noise present in the original.

CLOTHING:
Dress the replacement person in attire appropriate for the scene - matching the formality and era of the original photograph.

COMPOSITION:
Position the replacement person at correct scale and perspective relative to Epstein. The pose should look natural and relaxed, fitting the context of the scene. Ensure seamless edge integration with no haloing or obvious compositing artifacts.

Generate a photorealistic composite that looks like an authentic photograph - as if both people were actually present when the camera captured this moment.`
};

/**
 * Get the prompt for a specific photo
 * @param {string} photoPath - The photo filename or path (e.g., '/epstein-photos/epstein_bill_silk.jpg')
 * @returns {string} The custom prompt or default prompt
 */
function getPromptForPhoto(photoPath) {
  // Extract just the filename from the path
  const filename = photoPath.split('/').pop();

  // Return custom prompt if exists, otherwise default
  return photoPrompts[filename] || photoPrompts['_default'];
}

module.exports = { photoPrompts, getPromptForPhoto };
