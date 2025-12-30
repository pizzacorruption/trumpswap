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
  // Ghislaine Maxwell & Epstein at event
  // 90s event, flash photography, military-style jacket
  // ============================================
  'epstein_ghislain.jpg': `Create a new composite image by combining elements from both provided images.

TASK: Replace Ghislaine Maxwell (the woman on the RIGHT with short dark hair wearing a distinctive navy blue military-style jacket with gold fringe epaulettes and gold buttons, carrying a small red handbag) with the person from the second image. Keep Jeffrey Epstein (the man on the LEFT with gray hair wearing a dark navy button-down shirt tucked into light blue jeans with a brown leather belt) exactly as he appears.

FACE PRESERVATION - CRITICAL:
The replacement person's face must be kept 100% identical to the second image. Preserve every facial feature exactly: face shape, eye spacing, nose structure, jawline, skin tone, and all distinctive characteristics. Do not alter, age, smooth, or modify any facial features.

CLOTHING TRANSFORMATION - IMPORTANT:
Dress the replacement person in the SAME distinctive navy blue military-style jacket that Ghislaine is wearing - it has gold/cream colored fringe epaulettes on the shoulders, gold decorative buttons down the front, and gold stripe trim on the collar and cuffs. Give them the same small red handbag held at their side. The outfit should look like authentic 1990s fashion.

SETTING CONTEXT:
This is at an indoor entertainment event (appears to be a movie premiere or party - "Clue" signage visible in background). There are people in the background including waitstaff in white shirts. The floor appears to be dark polished surface reflecting light.

LIGHTING & STYLE:
This is classic 1990s event flash photography. Apply harsh direct flash lighting that creates bright faces with slight overexposure and darker shadowed backgrounds. The color temperature is warm with slight magenta/purple cast typical of 90s film stock. Add subtle film grain and the slightly compressed dynamic range of consumer flash photography from that era.

COMPOSITION:
Position the replacement person at the exact same location and scale as Ghislaine, walking side-by-side with Epstein at a social event. Both should appear relaxed and smiling, as if casually strolling through the venue together. Maintain their body language as a comfortable couple arriving at an event.

Generate a photorealistic composite that looks like an authentic 1990s event photograph.`,

  // ============================================
  // Larry Summers & Epstein at social gathering
  // Indoor event, candid group conversation
  // ============================================
  'epstein.summers.avif': `Create a new composite image by combining elements from both provided images.

TASK: Replace Larry Summers (the balding man on the far RIGHT wearing a gray tweed blazer over a dark shirt) with the person from the second image. Keep Jeffrey Epstein (the man second from LEFT in the dark navy polo shirt with arms crossed, laughing) and all other people in the scene exactly as they appear.

FACE PRESERVATION - CRITICAL:
The replacement person's face must be kept 100% identical to the second image. Preserve every facial feature exactly: face shape, eye spacing, nose structure, jawline, skin tone, and all distinctive characteristics. Do not alter, age, smooth, or modify any facial features.

CLOTHING TRANSFORMATION:
Dress the replacement person in similar professional-casual attire to Summers - a gray tweed or herringbone blazer over a dark colored shirt. The outfit should look appropriate for an academic or professional social gathering.

SETTING CONTEXT:
This is an indoor social gathering, possibly in a kitchen or break room area with beige cabinets visible in the background. Multiple men are engaged in casual conversation. The atmosphere is relaxed and intellectual - the kind of gathering you'd see at a university or think tank event.

LIGHTING & STYLE:
Match the warm indoor ambient lighting typical of candid event photography. The lighting is soft and diffused, coming from overhead fixtures. Skin tones should appear warm and natural. Preserve the candid, unposed quality of the original - this is clearly a snapshot taken during genuine conversation.

COMPOSITION:
Position the replacement person at the exact same location and scale as Summers, engaged in the group conversation. The replacement person should appear to be looking toward Epstein with a friendly, engaged expression, as if in the middle of an animated discussion. Maintain the natural group dynamics of several people conversing at a social event.

OTHER PEOPLE IN SCENE (DO NOT MODIFY):
- Far left: Older man in blue shirt with colorful tie
- Center-back: Person with curly dark hair (partially visible)
- Center-right: Man in light blue button-down shirt with glasses

Generate a photorealistic composite that looks like an authentic candid photograph from a social gathering.`,

  // ============================================
  // Epstein Jail Mugshot - SPECIAL: Generate user NEXT TO Epstein
  // Institutional mugshot style, beige background
  // ============================================
  'epstein_JAIL.webp': `Create a new composite image that places the person from the second image NEXT TO Jeffrey Epstein in a matching mugshot-style photograph.

TASK: This is NOT a face replacement. Generate the person from the second image standing BESIDE Epstein, as if they were both photographed together in the same institutional mugshot setting. Epstein should remain on the LEFT side of the frame, and the new person should appear on the RIGHT.

FACE PRESERVATION - CRITICAL:
The person from the second image must have their face kept 100% identical. Preserve every facial feature exactly: face shape, eye spacing, nose structure, jawline, skin tone, and all distinctive characteristics. Do not alter, age, smooth, or modify any facial features.

EPSTEIN'S APPEARANCE (PRESERVE EXACTLY):
Epstein appears disheveled with gray stubble beard, unkempt gray hair, weathered/aged skin with visible wrinkles, and a neutral/somber expression. He is wearing a plain gray crew-neck t-shirt. His skin tone appears slightly ruddy with visible pores and age spots.

CLOTHING FOR NEW PERSON:
Dress the new person in a similar plain institutional-style garment - either a matching gray t-shirt or an orange/tan jail jumpsuit top. The clothing should look plain and institutional, appropriate for a booking photo.

BACKGROUND & SETTING:
The background is a plain beige/cream colored institutional wall - the kind used in police booking photographs. Extend this same flat, featureless background behind both subjects. There should be no visible text, height markers, or other elements - just the plain wall.

LIGHTING - CRITICAL FOR MATCHING:
This is harsh institutional fluorescent lighting from directly above and front. Apply the same unflattering overhead lighting to the new person:
- Flat, even illumination with minimal shadows
- Slightly harsh quality that emphasizes skin texture
- Neutral-cool color temperature typical of fluorescent lights
- No dramatic shadows or artistic lighting

CAMERA STYLE:
This is a standard ID/booking photograph:
- Shot from chest-up (upper body framing)
- Direct, straight-on angle (no artistic angles)
- Sharp focus across the entire image
- Clinical, documentary quality
- Both subjects should appear at the same scale and distance from camera

COMPOSITION:
Frame both Epstein and the new person side-by-side in a horizontal composition, as if they were photographed together for a double booking photo. Both should be facing the camera directly with neutral expressions. Leave a small gap between them but they should clearly be in the same photograph together.

Generate a photorealistic image that looks like an authentic institutional photograph - clinical, unflattering, and documentary in nature.`,

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
