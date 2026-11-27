import { isLowRating } from "../../src/modules/questions/questions.constants.js";

describe("low-rating policy", () => {
  it.each([
    [false, 1, true], [false, 2, true], [false, 3, false], [false, 5, false],
    [true, 0, true], [true, 5, true], [true, 6, false], [true, 10, false],
  ])("uses the configured threshold for %s score %s", (isNps, score, expected) => {
    expect(isLowRating(isNps, score)).toBe(expected);
  });
});
