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
// Conciseness — tests ability to be brief
// ============================================================================
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
