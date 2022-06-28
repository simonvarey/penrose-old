import { tsAnalyzePropertyAccess, TsPropertyAccess } from "analysis/Typescript";
import { compDict } from "contrib/Functions";
import { atan2 } from "engine/AutodiffFunctions";
import { Context } from "shapes/Samplers";
import * as ad from "types/ad";
import { FloatV } from "types/value";

// ------------------------------- Functions for Testing ----------------------------- //

/**
 * A function where searching for _context yeields no hits.
 *
 * @param _context
 * @param v
 * @returns
 */
const testTsAnalyzePropertyAccessIntraNoHits = (
  _context: Context,
  v: ad.Num[]
): FloatV<ad.Num> => {
  return { tag: "FloatV", contents: atan2(v[1], v[0]) };
};

/**
 * A function where the property access is in the return statement.
 *
 * @param s
 * @returns
 */
const testTsAnalyzePropertyAccessRetVal1 = (s: any): FloatV<ad.Num> => {
  const x = 5;
  const y = x + 3;
  return {
    tag: "FloatV",
    contents: s.r.contents,
  };
};

/**
 * A function where the property access is in the return statement.
 *
 * @param s
 * @returns
 */
const testTsAnalyzePropertyAccessRetVal2 = (s: any): ad.Num => {
  const [x, y] = [5, 3];
  const z = x + 3;
  return s.r.contents;
};

/**
 * A function where the property access is indirectly through another variable.
 *
 * @param _context
 * @param s
 */
const testTsAnalyzePropertyAccessAssign = (_context: Context, s: any): void => {
  const pi = compDict.MathPI(_context);
  const y: any = s;
  const e = compDict.MathE(_context);
  const z = s.r;
  const e2 = compDict.MathE(_context);
};

/**
 * A function where the property access is by way of creating an object
 *
 * @param s
 */
const testTsAnalyzePropertyAccessObj = (s: any): void => {
  const { r } = s;
  const x = r;
};

/**
 * A function where the property access is via LVal assignment.
 *
 * @param s
 */
const testTsAnalyzePropertyLValueProp = (s: any): void => {
  s.r = 1;
  s.r = 2;
};

/**
 * A function where the property access is by way of calling a function
 *
 * @param s
 */
const testTsAnalyzePropertyAccessFn = (s: any): void => {
  const r = (): { s: boolean } => {
    return { s: true };
  };
  const x = r().s;
};

/**
 * A function where the property assignment is by way of calling a function
 *
 * @param s
 */
const testTsAnalyzePropertyAssignFn = (s: any): void => {
  const r = (): { s: any } => {
    return { s: true };
  };
  r().s = s.r;
};

/**
 * A function with no arguments.
 */
const testTsAnalyzePropertyAccessNoArgErr = (): void => {
  const x = 5;
};

/**
 * A function where a variable of interest is assigned to multiple times.
 *
 * @param s1
 * @param s2
 */
const testTsAnalyzePropertyAccessMultiAssignErr = (s1: any, s2: any): void => {
  s2 = s1;
  const x = s2.r;
};

/**
 * A function where the property access is via array.
 *
 * @param s
 */
const testTsAnalyzePropertyAccessArrayErr = (s: any): void => {
  const x = [s]; // Exception
  const y = x[0].r;
};

/**
 * A function where the property access is via an object
 *
 * @param s
 */
const testTsAnalyzePropertyAccessObjErr = (s: any): void => {
  const s2 = { shape: s }; // Exception
  const x = s2.shape.r;
};

/**
 * A function where the variable of interest is assigned to.
 *
 * @param s
 */
const testTsAnalyzePropertyLValueErr = (s: any): void => {
  s = 1; // Exception
};

// ---------------------------------- Helper Functions ------------------------------- //

/**
 * Tests a function analysis for deep equality.
 *
 * @param fn Function to analyze
 * @param arg Argument name or offset
 * @param expected Expected result
 */
const testFnEq = (
  fn: Function,
  arg: string | number,
  expected: TsPropertyAccess[]
): void => {
  test(fn.name, async () => {
    expect(
      tsAnalyzePropertyAccess("fn", arg, fn.toString()).toArray().sort()
    ).toEqual(expected);
  });
};

/**
 * Tests a function analysis to ensure it returns an exception.
 *
 * @param fn Function to analyze
 * @param arg Argument name or offset
 */
const testFnException = (fn: Function, arg: string | number): void => {
  test(fn.name, async () => {
    expect(() =>
      tsAnalyzePropertyAccess("fn", arg, fn.toString())
    ).toThrowError();
  });
};

// ---------------------------------- The Actual Tests ------------------------------- //

/**
 * Tests for the TypeScript Property Analysis
 */
describe("TS Property Analysis", () => {
  testFnEq(testTsAnalyzePropertyAccessIntraNoHits, "_context", []);
  testFnEq(testTsAnalyzePropertyAccessFn, "s", []);
  testFnEq(testTsAnalyzePropertyAssignFn, "s", [
    { fnName: "fn", varName: "s", propName: "r" },
  ]);
  testFnEq(compDict.midpointOffset, "s1", [
    { fnName: "linePts", varName: "_a", propName: "start" },
    { fnName: "linePts", varName: "_a", propName: "end" },
  ]);
  testFnEq(compDict.signedDistance, "s", [
    { fnName: "fn", varName: "s", propName: "center" },
    { fnName: "fn", varName: "s", propName: "width" },
    { fnName: "fn", varName: "s", propName: "height" },
    { fnName: "fn", varName: "s", propName: "r" },
    { fnName: "fn", varName: "s", propName: "points" },
    { fnName: "sdLine", varName: "s", propName: "start" },
    { fnName: "sdLine", varName: "s", propName: "end" },
    { fnName: "sdPolyline", varName: "s", propName: "points" },
  ]);
  testFnEq(testTsAnalyzePropertyAccessRetVal1, "s", [
    { fnName: "fn", varName: "s", propName: "r" },
  ]);
  testFnEq(testTsAnalyzePropertyAccessRetVal2, "s", [
    { fnName: "fn", varName: "s", propName: "r" },
  ]);
  testFnEq(testTsAnalyzePropertyAccessAssign, "s", [
    { fnName: "fn", varName: "s", propName: "r" },
  ]);
  testFnEq(testTsAnalyzePropertyAccessObj, "s", [
    { fnName: "fn", varName: "s", propName: "r" },
  ]);
  testFnEq(testTsAnalyzePropertyLValueProp, "s", [
    { fnName: "fn", varName: "s", propName: "r" },
  ]);
  testFnException(testTsAnalyzePropertyAccessNoArgErr, "s");
  testFnException(testTsAnalyzePropertyAccessMultiAssignErr, "s1");
  testFnException(testTsAnalyzePropertyAccessMultiAssignErr, "s2");
  testFnException(testTsAnalyzePropertyAccessArrayErr, "s");
  testFnException(testTsAnalyzePropertyAccessObjErr, "s");
  testFnException(testTsAnalyzePropertyLValueErr, "s");
});
