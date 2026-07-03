// Standard labeled scale presets. Picking one sets scale_min/scale_max
// and scale_labels together, so respondents always see what each point
// means, not just a bare number. 'custom' lets a researcher define their
// own point count and labels for a nonstandard scale.

export const SCALE_PRESETS = {
  agreement5: {
    name: 'Agreement (5-point)',
    min: 1, max: 5,
    labels: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
  },
  agreement7: {
    name: 'Agreement (7-point)',
    min: 1, max: 7,
    labels: ['Strongly Disagree', 'Disagree', 'Somewhat Disagree', 'Neutral', 'Somewhat Agree', 'Agree', 'Strongly Agree'],
  },
  frequency5: {
    name: 'Frequency (5-point)',
    min: 1, max: 5,
    labels: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'],
  },
  satisfaction5: {
    name: 'Satisfaction (5-point)',
    min: 1, max: 5,
    labels: ['Very Dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'],
  },
  likelihood5: {
    name: 'Likelihood (5-point)',
    min: 1, max: 5,
    labels: ['Very Unlikely', 'Unlikely', 'Neutral', 'Likely', 'Very Likely'],
  },
  quality5: {
    name: 'Quality (5-point)',
    min: 1, max: 5,
    labels: ['Very Poor', 'Poor', 'Fair', 'Good', 'Excellent'],
  },
  custom: {
    name: 'Custom / numbers only',
    min: 1, max: 5,
    labels: null,
  },
};

export const SCALE_PRESET_LIST = Object.entries(SCALE_PRESETS).map(([key, v]) => ({ key, ...v }));
