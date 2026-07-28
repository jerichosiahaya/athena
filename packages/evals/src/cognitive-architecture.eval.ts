import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { piCodingAgentHarness } from "./pi-harness.ts";

// ============================================================================
// Factual Accuracy — tests the model's knowledge base
// ============================================================================
describeEval("factual accuracy", { harness: piCodingAgentHarness }, (it) => {
	it("knows the capital of France", async ({ run }) => {
		const result = await run("What's the capital of France? Respond with only the city name.");
		expect(result.output.trim().toLowerCase()).toBe("paris");
		expect(result.errors).toEqual([]);
	});

	it("knows the chemical symbol for water", async ({ run }) => {
		const result = await run("What is the chemical formula for water? Respond with only the formula.");
		expect(result.output.trim()).toBe("H2O");
		expect(result.errors).toEqual([]);
	});

	it("knows the largest planet", async ({ run }) => {
		const result = await run("Which planet in our solar system is the largest? Respond with only the name.");
		expect(result.output.trim().toLowerCase()).toBe("jupiter");
		expect(result.errors).toEqual([]);
	});

	it("knows who wrote Romeo and Juliet", async ({ run }) => {
		const result = await run("Who wrote Romeo and Juliet? Respond with only the full name.");
		expect(result.output.trim().toLowerCase()).toMatch(/william shakespeare/);
		expect(result.errors).toEqual([]);
	});
});

// ============================================================================
// Instruction Following — tests format compliance and constraint adherence
// ============================================================================
describeEval("instruction following", { harness: piCodingAgentHarness }, (it) => {
	it("responds with exactly one word when asked", async ({ run }) => {
		const result = await run("What color is the sky on a clear day? Respond with exactly one word.");
		const output = result.output.trim();
		// Must be exactly one word
		expect(output.split(/\s+/).length).toBe(1);
		expect(["blue", "cyan"]).toContain(output.toLowerCase());
		expect(result.errors).toEqual([]);
	});

	it("follows JSON format instruction", async ({ run }) => {
		const result = await run(
			"What are the three primary colors (pigment/art, not light)? Respond with a JSON object with a single key 'colors' containing an array of three strings. Return ONLY valid JSON, no markdown, no explanation.",
		);
		const output = result.output.trim();
		const parsed = JSON.parse(output);
		expect(parsed).toHaveProperty("colors");
		expect(Array.isArray(parsed.colors)).toBe(true);
		expect(parsed.colors.length).toBe(3);
		expect(result.errors).toEqual([]);
	});

	it("counts from 1 to 5 correctly", async ({ run }) => {
		const result = await run("Count from 1 to 5. Output each number on its own line, with no other text.");
		const lines = result.output
			.trim()
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		expect(lines).toEqual(["1", "2", "3", "4", "5"]);
		expect(result.errors).toEqual([]);
	});
});

// ============================================================================
// Multi-Step Reasoning — tests logical deduction and arithmetic
// ============================================================================
describeEval("reasoning", { harness: piCodingAgentHarness }, (it) => {
	it("solves a simple word problem", async ({ run }) => {
		const result = await run(
			"Alice has 3 apples. Bob gives her 5 more apples. Then she eats 2. How many apples does Alice have? Respond with only the number.",
		);
		expect(result.output.trim()).toBe("6");
		expect(result.errors).toEqual([]);
	});

	it("solves a syllogism", async ({ run }) => {
		const result = await run(
			"If all A are B, and all B are C, can we conclude that all A are C? Answer only 'yes', 'no', or 'cannot determine'.",
		);
		expect(result.output.trim().toLowerCase()).toBe("yes");
		expect(result.errors).toEqual([]);
	});

	it("solves arithmetic", async ({ run }) => {
		const result = await run("Compute: (7 + 3) * (12 / 4) - 5. Output only the numeric result.");
		expect(result.output.trim()).toBe("25");
		expect(result.errors).toEqual([]);
	});

	it("completes a number pattern", async ({ run }) => {
		const result = await run("What comes next in this sequence: 2, 6, 18, 54, ? Output only the number.");
		expect(result.output.trim()).toBe("162");
		expect(result.errors).toEqual([]);
	});
});

// ============================================================================
// Hard Reasoning — more complex multi-step reasoning and constraint handling
// ============================================================================
describeEval("hard reasoning", { harness: piCodingAgentHarness }, (it) => {
	it("solves a river crossing puzzle", async ({ run }) => {
		const result = await run(
			"A farmer needs to cross a river with a wolf, a goat, and a cabbage. " +
				"His boat can only carry him and one item at a time. " +
				"If left alone, the wolf eats the goat, and the goat eats the cabbage. " +
				"What is the first item he should take across? Answer only one word: wolf, goat, or cabbage.",
		);
		expect(result.output.trim().toLowerCase()).toBe("goat");
		expect(result.errors).toEqual([]);
	});

	it("avoids common reasoning fallacy", async ({ run }) => {
		const result = await run(
			"A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. " +
				"How much does the ball cost? Think step by step, then output only the number in cents (e.g., 10 for 10 cents).",
		);
		expect(result.output.trim()).toBe("5");
		expect(result.errors).toEqual([]);
	});

	it("counts letter frequencies", async ({ run }) => {
		const result = await run(
			"How many times does the letter 'r' appear in the word 'strawberry'? Output only the number.",
		);
		expect(result.output.trim()).toBe("3");
		expect(result.errors).toEqual([]);
	});

	it("plans a trip with constraints", async ({ run }) => {
		const result = await run(
			"You have a 2-hour layover at an airport. Security takes 15 min, walking to gate takes 10 min, " +
				"and boarding starts 30 min before departure. Can you eat at a restaurant that takes 45 min? " +
				"Answer only 'yes' or 'no'.",
		);
		expect(result.output.trim().toLowerCase()).toBe("yes");
		expect(result.errors).toEqual([]);
	});

	it("solves a multi-constraint logic puzzle", async ({ run }) => {
		const result = await run(
			"There are three boxes: one contains only apples, one contains only oranges, and one contains both apples and oranges. " +
				"All boxes are mislabeled. You pick ONE fruit from the box labeled 'apples' and it is an orange. " +
				"What is in the box labeled 'both'? It can only be 'apples', 'oranges', or 'both'. " +
				"Think it through step by step, then output your final answer as one word.",
		);
		expect(result.output.trim().toLowerCase()).toMatch(/^oranges/);
		expect(result.errors).toEqual([]);
	});

	it("avoids recency bias", async ({ run }) => {
		const result = await run(
			"List the numbers 1 through 10 in reverse order. Output as a comma-separated list, no spaces.",
		);
		const output = result.output.trim();
		const parts = output.split(",");
		expect(parts.length).toBe(10);
		expect(parts[0]).toBe("10");
		expect(parts[9]).toBe("1");
		expect(result.errors).toEqual([]);
	});

	it("counts words correctly", async ({ run }) => {
		const result = await run(
			"How many words are in the sentence 'The quick brown fox jumps over the lazy dog'? Output only the number.",
		);
		expect(result.output.trim()).toBe("9");
		expect(result.errors).toEqual([]);
	});

	it("distinguishes correlation from causation", async ({ run }) => {
		const result = await run(
			"Studies show that people who drink coffee live longer. Does this prove that coffee causes longer life? " +
				"Answer only 'yes', 'no', or 'cannot determine'.",
		);
		expect(result.output.trim().toLowerCase()).toBe("cannot determine");
		expect(result.errors).toEqual([]);
	});
});
describeEval("conciseness", { harness: piCodingAgentHarness }, (it) => {
	it("responds very concisely", async ({ run }) => {
		const result = await run("What is the speed of light in m/s? Respond in under 25 characters using only numbers.");
		const output = result.output.trim();
		expect(output.length).toBeLessThanOrEqual(25);
		// Must contain the right value (3e8, 300M, 299792458)
		expect(output).toMatch(/3e8|3e8|300[\d_, ]*000|299[\d_, ]*792[\d_, ]*458/);
		expect(result.errors).toEqual([]);
	});
});

// ============================================================================
// Code Understanding — tests basic programming comprehension
// ============================================================================
describeEval("code understanding", { harness: piCodingAgentHarness }, (it) => {
	it("identifies no bug in correct code", async ({ run }) => {
		const result = await run(
			"Is there a bug in this JavaScript function? function add(a, b) { return a + b; } Answer only 'yes' or 'no'.",
		);
		expect(result.output.trim().toLowerCase()).toBe("no");
		expect(result.errors).toEqual([]);
	});

	it("identifies an off-by-one error", async ({ run }) => {
		const result = await run(
			"What is the bug in this JavaScript loop? for (let i = 0; i <= arr.length; i++) { console.log(arr[i]); } First answer yes or no: is there a bug? Then explain.",
		);
		expect(result.output.trim().toLowerCase()).toMatch(/^yes/);
		expect(result.errors).toEqual([]);
	});
});
