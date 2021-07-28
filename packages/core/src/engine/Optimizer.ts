import consola, { LogLevel } from "consola";
import { constrDict, objDict } from "contrib/Constraints";
import eig from "eigen";
import {
  add,
  differentiable,
  energyAndGradCompiled,
  fns,
  makeADInputVars,
  markInput,
  mul,
  ops,
  varOf,
} from "engine/Autodiff";
import {
  defaultLbfgsParams,
  initConstraintWeight,
  makeTranslationDifferentiable,
  makeTranslationNumeric,
} from "engine/EngineUtils";
import {
  argValue,
  evalFn,
  evalFns,
  evalShapes,
  genPathMap,
  insertVaryings,
} from "engine/Evaluator";
import * as _ from "lodash";
import rfdc from "rfdc";
import { OptInfo, VarAD } from "types/ad";
import { MaybeVal } from "types/common";
import {
  Fn,
  FnCached,
  FnDone,
  LbfgsParams,
  Params,
  State,
  VaryMap,
  WeightInfo,
} from "types/state";
import { Path } from "types/style";
import {
  addv,
  dot,
  negv,
  normList,
  prettyPrintFn,
  prettyPrintFns,
  prettyPrintPath,
  repeat,
  scalev,
  subv,
} from "utils/OtherUtils";
import { colorUninitShapes, colorUninitText } from "renderer/Color";

// NOTE: to view logs, change `level` below to `LogLevel.Info`, otherwise it should be `LogLevel.Warn`
//const log = consola.create({ level: LogLevel.Info }).withScope("Optimizer");
const log = consola.create({ level: LogLevel.Warn }).withScope("Optimizer");

// For deep-cloning the translation
const clone = rfdc({ proto: false, circles: false });

////////////////////////////////////////////////////////////////////////////////
// Globals

// Printing flags
// const DEBUG_OPT = false;

// growth factor for constraint weights
const weightGrowthFactor = 10;

// weight for constraints
const constraintWeight = 10e4; // HACK: constant constraint weight
// const constraintWeight = 1; // TODO: If you want to minimally satisfify the constraint. Figure out which one works better wrt `initConstraintWeight`, as the constraint weight is increased by the growth factor anyway

// EP method convergence criteria
const epStop = 1e-3;
// const epStop = 1e-5;
// const epStop = 1e-7;

const EPSD = 1e-11;

// Unconstrained method convergence criteria
// TODO. This should REALLY be 10e-10
// NOTE: The new autodiff + line search seems to be really sensitive to this parameter (`uoStop`). It works for 1e-2, but the line search ends up with too-small intervals with 1e-5
const uoStop = 1e-2;
// const uoStop = 1e-3;
// const uoStop = 1e-5;
// const uoStop = 10;

// const DEBUG_GRAD_DESCENT = true;
const DEBUG_GRAD_DESCENT = false;
const USE_LINE_SEARCH = true;
const BREAK_EARLY = true;
const DEBUG_LBFGS = false;

const EPS = uoStop;

////////////////////////////////////////////////////////////////////////////////

const unconstrainedConverged2 = (normGrad: number): boolean => {
  if (DEBUG_GRAD_DESCENT) {
    log.info("UO convergence check: ||grad f(x)||", normGrad);
  }
  return normGrad < uoStop;
};

const epConverged2 = (
  xs0: number[],
  xs1: number[],
  fxs0: number,
  fxs1: number
): boolean => {
  // TODO: These dx and dfx should really be scaled to account for magnitudes
  const stateChange = normList(subv(xs1, xs0));
  const energyChange = Math.abs(fxs1 - fxs0);
  log.info(
    "epConverged?: stateChange: ",
    stateChange,
    " | energyChange: ",
    energyChange
  );

  return stateChange < epStop || energyChange < epStop;
};

const applyFn = (f: FnDone<VarAD>, dict: any) => {
  if (dict[f.name]) {
    return dict[f.name](...f.args.map(argValue));
  } else {
    throw new Error(
      `constraint or objective ${f.name} not found in dirctionary`
    );
  }
};

/**
 * Given a `State`, take n steps by evaluating the overall objective function
 *
 * @param {State} state
 * @param {number} steps
 * @returns
 */

// TODO. Annotate the return type: a new (copied?) state with the varyingState and opt params set?

// NOTE: `stepEP` implements the exterior point method as described here:
// https://www.me.utexas.edu/~jensen/ORMM/supplements/units/nlp_methods/const_opt.pdf (p7)

// Things that we should do programmatically improve the conditioning of the objective function:
// 1) scale the constraints so that the penalty generated by each is about the same magnitude
// 2) fix initial value of the penalty parameter so that the magnitude of the penalty term is not much smaller than the magnitude of objective function

export const initializeMat = async () => {
  await eig.ready;
};

/**
 * Requires await initializeMat() to be called first
 * @param state
 * @param steps
 * @param evaluate
 */
export const step = (state: State, steps: number, evaluate = true): State => {
  const { optStatus, weight } = state.params;
  let newState = { ...state };
  const optParams = newState.params; // this is just a reference, so updating this will update newState as well
  let xs: number[] = state.varyingValues;

  log.info("===============");
  log.info(
    "step | weight: ",
    weight,
    "| EP round: ",
    optParams.EPround,
    " | UO round: ",
    optParams.UOround
  );
  log.info("params: ", optParams);
  // log.info("state: ", state);
  log.info("fns: ", prettyPrintFns(state));
  log.info(
    "variables: ",
    state.varyingPaths.map((p: Path): string => prettyPrintPath(p))
  );

  switch (optStatus) {
    case "NewIter": {
      log.trace("step newIter, xs", xs);

      // if (!state.params.functionsCompiled) {
      // TODO: Doesn't reuse compiled function for now (since caching function in App currently does not work)
      if (true) {
        const { objective, gradient } = state.params;
        if (!objective || !gradient) {
          return genOptProblem(state);
        } else {
          return {
            ...state,
            params: {
              ...state.params,
              weight: initConstraintWeight,
              UOround: 0,
              EPround: 0,
              optStatus: "UnconstrainedRunning" as const,
              lbfgsInfo: defaultLbfgsParams,
            },
          };
        }
      } else {
        // Reuse compiled functions for resample; set other initialization params accordingly
        // The computational graph gets destroyed in resample (just for now, because it can't get serialized)
        // But it's not needed for the optimization
        log.info("Reusing compiled objective and gradients");
        const params = state.params;

        const newParams: Params = {
          ...params,
          lastGradient: repeat(xs.length, 0),
          lastGradientPreconditioned: repeat(xs.length, 0),
          currObjective: params.objective(initConstraintWeight),
          currGradient: params.gradient(initConstraintWeight),
          weight: initConstraintWeight,
          UOround: 0,
          EPround: 0,
          optStatus: "UnconstrainedRunning",
          lbfgsInfo: defaultLbfgsParams,
        };

        return { ...state, params: newParams };
      }
    }

    case "UnconstrainedRunning": {
      // NOTE: use cached varying values
      log.info("step step, xs", xs);

      const res = minimize(
        xs,
        state.params.currObjective,
        state.params.currGradient,
        state.params.lbfgsInfo,
        state.varyingPaths.map((p) => prettyPrintPath(p)),
        steps
      );
      xs = res.xs;

      // the new `xs` is put into the `newState`, which is returned at end of function
      // we don't need the updated xsVars and energyGraph as they are always cleared on evaluation; only their structure matters
      const {
        energyVal,
        normGrad,
        newLbfgsInfo,
        gradient,
        gradientPreconditioned,
        failed,
      } = res;

      optParams.lastUOstate = xs;
      optParams.lastUOenergy = energyVal;
      optParams.UOround = optParams.UOround + 1;
      optParams.lbfgsInfo = newLbfgsInfo;
      optParams.lastGradient = gradient;
      optParams.lastGradientPreconditioned = gradientPreconditioned;

      // NOTE: `varyingValues` is updated in `state` after each step by putting it into `newState` and passing it to `evalTranslation`, which returns another state

      // TODO. In the original optimizer, we cheat by using the EP cond here, because the UO cond is sometimes too strong.
      if (unconstrainedConverged2(normGrad)) {
        optParams.optStatus = "UnconstrainedConverged";
        eig.GC.flush(); // Clear allocated matrix, vector objects in L-BFGS params
        optParams.lbfgsInfo = defaultLbfgsParams;
        log.info(
          "Unconstrained converged with energy",
          energyVal,
          "gradient norm",
          normGrad
        );
      } else {
        optParams.optStatus = "UnconstrainedRunning";
        // Note that lbfgs prams have already been updated
        log.info(
          `Took ${steps} steps. Current energy`,
          energyVal,
          "gradient norm",
          normGrad
        );
      }
      if (failed) {
        log.warn("Error detected after stepping");
        optParams.optStatus = "Error";
        return newState;
      }

      break;
    }

    case "UnconstrainedConverged": {
      // No minimization step should be taken. Just figure out if we should start another UO round with higher EP weight.
      // We are using the last UO state and energy because they serve as the current EP state and energy, and comparing it to the last EP stuff.

      // Do EP convergence check on the last EP state (and its energy), and curr EP state (and its energy)
      // (There is no EP state or energy on the first round)
      // Note that lbfgs params have already been reset to default

      // TODO. Make a diagram to clarify vocabulary
      log.info("step: unconstrained converged", optParams);

      // We force EP to run at least two rounds (State 0 -> State 1 -> State 2; the first check is only between States 1 and 2)
      if (
        optParams.EPround > 1 &&
        epConverged2(
          optParams.lastEPstate,
          optParams.lastUOstate,
          optParams.lastEPenergy,
          optParams.lastUOenergy
        )
      ) {
        optParams.optStatus = "EPConverged";
        log.info("EP converged with energy", optParams.lastUOenergy);
      } else {
        // If EP has not converged, increase weight and continue.
        // The point is that, for the next round, the last converged UO state becomes both the last EP state and the initial state for the next round--starting with a harsher penalty.
        log.info(
          "step: UO converged but EP did not converge; starting next round"
        );
        optParams.optStatus = "UnconstrainedRunning";

        optParams.weight = weightGrowthFactor * weight;
        optParams.EPround = optParams.EPround + 1;
        optParams.UOround = 0;

        optParams.currObjective = optParams.objective(optParams.weight);
        optParams.currGradient = optParams.gradient(optParams.weight);

        log.info(
          "increased EP weight to",
          optParams.weight,
          "in compiled energy and gradient"
        );
      }

      // Done with EP check, so save the curr EP state as the last EP state for the future.
      optParams.lastEPstate = optParams.lastUOstate;
      optParams.lastEPenergy = optParams.lastUOenergy;

      break;
    }

    case "EPConverged": {
      // do nothing if converged
      log.info("step: EP converged");
      return state;
    }
    case "Error": {
      log.warn("step: Error");
      return state;
    }
  }

  // return the state with a new set of shapes
  if (evaluate) {
    const varyingValues = xs;
    // log.info("evaluating state with varying values", varyingValues);
    // log.info("varyingMap", zip(state.varyingPaths, varyingValues) as [Path, number][]);

    newState.translation = insertVaryings(
      state.translation,
      _.zip(state.varyingPaths, varyingValues.map(differentiable)) as [
        Path,
        VarAD
      ][]
    );

    newState.varyingValues = varyingValues;
    newState = evalShapes(newState);

    // color assignment
    newState = colorUninitText(colorUninitShapes(newState));
  }

  return newState;
};

// Note: line search seems to be quite sensitive to the maxSteps parameter; with maxSteps=25, the line search might

const awLineSearch2 = (
  xs0: number[],
  f: (zs: number[]) => number,
  gradf: (zs: number[]) => number[],

  gradfxs0: number[],
  fxs0: number,
  maxSteps = 10
) => {
  const descentDir = negv(gradfxs0); // This is preconditioned by L-BFGS

  const duf = (u: number[]) => {
    return (zs: number[]) => {
      return dot(u, gradf(zs));
    };
  };

  const dufDescent = duf(descentDir);
  const dufAtx0 = dufDescent(xs0);
  const minInterval = 10e-10;

  // HS (Haskell?): duf, TS: dufDescent
  // HS: x0, TS: xs

  // Hyperparameters
  const c1 = 0.001; // Armijo
  const c2 = 0.9; // Wolfe

  // Armijo condition
  // f(x0 + t * descentDir) <= (f(x0) + c1 * t * <grad(f)(x0), x0>)
  const armijo = (ti: number): boolean => {
    const cond1 = f(addv(xs0, scalev(ti, descentDir)));
    const cond2 = fxs0 + c1 * ti * dufAtx0;
    return cond1 <= cond2;
  };

  // D(u) := <grad f, u>
  // D(u, f, x) = <grad f(x), u>
  // u is the descentDir (i.e. -grad(f)(x))

  // Strong Wolfe condition
  // |<grad(f)(x0 + t * descentDir), u>| <= c2 * |<grad f(x0), u>|
  const strongWolfe = (ti: number) => {
    const cond1 = Math.abs(dufDescent(addv(xs0, scalev(ti, descentDir))));
    const cond2 = c2 * Math.abs(dufAtx0);
    return cond1 <= cond2;
  };

  // Weak Wolfe condition
  // <grad(f)(x0 + t * descentDir), u> >= c2 * <grad f(x0), u>
  const weakWolfe = (ti: number) => {
    const cond1 = dufDescent(addv(xs0, scalev(ti, descentDir)));
    const cond2 = c2 * dufAtx0;
    return cond1 >= cond2;
  };

  const wolfe = weakWolfe; // Set this if using strongWolfe instead

  // Interval check
  const shouldStop = (numUpdates: number, ai: number, bi: number) => {
    const intervalTooSmall = Math.abs(bi - ai) < minInterval;
    const tooManySteps = numUpdates > maxSteps;

    if (intervalTooSmall && DEBUG_LINE_SEARCH) {
      log.info("line search stopping: interval too small");
    }
    if (tooManySteps && DEBUG_LINE_SEARCH) {
      log.info("line search stopping: step count exceeded");
    }

    return intervalTooSmall || tooManySteps;
  };

  // Consts / initial values
  // TODO: port comments from original

  // const t = 0.002; // for venn_simple.sty
  // const t = 0.1; // for tree.sty

  let a = 0;
  let b = Infinity;
  let t = 1.0;
  let i = 0;
  const DEBUG_LINE_SEARCH = false;

  if (DEBUG_LINE_SEARCH) {
    log.info("line search", xs0, gradfxs0, duf(xs0)(xs0));
  }

  // Main loop + update check
  while (true) {
    const needToStop = shouldStop(i, a, b);

    if (needToStop) {
      if (DEBUG_LINE_SEARCH) {
        log.info("stopping early: (i, a, b, t) = ", i, a, b, t);
      }
      break;
    }

    const isArmijo = armijo(t);
    const isWolfe = wolfe(t);
    if (DEBUG_LINE_SEARCH) {
      log.info("(i, a, b, t), armijo, wolfe", i, a, b, t, isArmijo, isWolfe);
    }

    if (!isArmijo) {
      if (DEBUG_LINE_SEARCH) {
        log.info("not armijo");
      }
      b = t;
    } else if (!isWolfe) {
      if (DEBUG_LINE_SEARCH) {
        log.info("not wolfe");
      }
      a = t;
    } else {
      if (DEBUG_LINE_SEARCH) {
        log.info("found good interval");
        log.info("stopping: (i, a, b, t) = ", i, a, b, t);
      }
      break;
    }

    if (b < Infinity) {
      if (DEBUG_LINE_SEARCH) {
        log.info("already found armijo");
      }
      t = (a + b) / 2.0;
    } else {
      if (DEBUG_LINE_SEARCH) {
        log.info("did not find armijo");
      }
      t = 2.0 * a;
    }

    i++;
  }

  return t;
};

const vecList = (xs: any): number[] => {
  // Prints a col vector (nx1)
  const res = [];
  for (let i = 0; i < xs.rows(); i++) {
    res.push(xs.get(i, 0));
  }
  return res;
};

const printVec = (xs: any) => {
  // Prints a col vector (nx1)
  log.info("xs (matrix)", vecList(xs));
};

const colVec = (xs: number[]): any => {
  // Return a col vector (nx1)
  // TODO: What is the performance of this?
  const m = eig.Matrix.constant(xs.length, 1, 0); // rows x cols
  xs.forEach((e, i) => m.set(i, 0, e));

  // log.info("original xs", xs);
  // printVec(m);
  return m;
};

// v is a col vec, w is a col vec, they need to be the same size, returns v dot w (removed from its container)
const dotVec = (v: any, w: any): number => v.transpose().matMul(w).get(0, 0);

// Precondition the gradient:
// Approximate the inverse of the Hessian times the gradient
// Only using the last `m` gradient/state difference vectors, not building the full h_k matrix (Nocedal p226)

// `any` here is a column vector type
const lbfgsInner = (grad_fx_k: any, ss: any[], ys: any[]): any => {
  // TODO: See if using the mutation methods in linear-algebra-js (instead of the return-a-new-matrix ones) yield any speedup
  // Also see if rewriting outside the functional style yields speedup (e.g. less copying of matrix objects -> less garbage collection)

  // Helper functions
  const calculate_rho = (s: any, y: any): number => {
    return 1.0 / (dotVec(y, s) + EPSD);
  };

  // `any` = column vec
  const pull_q_back = (
    acc: [any, number[]],
    curr: [number, any, any]
  ): [any, number[]] => {
    const [q_i_plus_1, alphas2] = acc; // alphas2 is the same stuff as alphas, just renamed to avoid shadowing
    const [rho_i, s_i, y_i] = curr;

    const alpha_i: number = rho_i * dotVec(s_i, q_i_plus_1);
    const q_i: any = q_i_plus_1.matSub(y_i.mul(alpha_i));

    return [q_i, alphas2.concat([alpha_i])]; // alphas, left to right
  };

  // takes two column vectors (nx1), returns a square matrix (nxn)
  const estimate_hess = (y_km1: any, s_km1: any): any => {
    const gamma_k = dotVec(s_km1, y_km1) / (dotVec(y_km1, y_km1) + EPSD);
    const n = y_km1.rows();
    return eig.Matrix.identity(n, n).mul(gamma_k);
  };

  // `any` = column vec
  const push_r_forward = (
    r_i: any,
    curr: [[number, number], [any, any]]
  ): any => {
    const [[rho_i, alpha_i], [s_i, y_i]] = curr;
    const beta_i: number = rho_i * dotVec(y_i, r_i);
    const r_i_plus_1 = r_i.matAdd(s_i.mul(alpha_i - beta_i));
    return r_i_plus_1;
  };

  // BACKWARD: for i = k-1 ... k-m
  // The length of any list should be the number of stored vectors
  const rhos = _.zip(ss, ys).map(([s, y]) => calculate_rho(s, y));
  const q_k = grad_fx_k;
  // Note the order of alphas will be from k-1 through k-m for the push_r_forward loop
  // (Note that `reduce` is a left fold)
  const [q_k_minus_m, alphas] = (_.zip(rhos, ss, ys) as any).reduce(
    pull_q_back,
    [q_k, []]
  );

  const h_0_k = estimate_hess(ys[0], ss[0]); // nxn matrix, according to Nocedal p226, eqn 9.6

  // FORWARD: for i = k-m .. k-1
  // below: [nxn matrix * nx1 (col) vec] -> nx1 (col) vec
  const r_k_minus_m = h_0_k.matMul(q_k_minus_m);
  // Note that rhos, alphas, ss, and ys are all in order from `k-1` to `k-m` so we just reverse all of them together to go from `k-m` to `k-1`
  // NOTE: `reverse` mutates the array in-place, which is fine because we don't need it later
  const inputs = _.zip(_.zip(rhos, alphas), _.zip(ss, ys)).reverse() as any;
  const r_k = inputs.reduce(push_r_forward, r_k_minus_m);

  // result r_k is H_k * grad f(x_k)
  return r_k;
};

// Outer loop of lbfgs
// See Optimizer.hs for any add'l comments
const lbfgs = (xs: number[], gradfxs: number[], lbfgsInfo: LbfgsParams) => {
  // Comments for normal BFGS:
  // For x_{k+1}, to compute H_k, we need the (k-1) info
  // Our convention is that we are always working "at" k to compute k+1
  // x_0 doesn't require any H; x_1 (the first step) with k = 0 requires H_0
  // x_2 (the NEXT step) with k=1 requires H_1. For example>
  // x_2 = x_1 - alpha_1 H_1 grad f(x_1)   [GD step]
  // H_1 = V_0 H_0 V_0 + rho_0 s_0 s_0^T   [This is confusing because the book adds an extra +1 to the H index]
  // V_0 = I - rho_0 y_0 s_0^T
  // rho_0 = 1 / y_0^T s_0
  // s_0 = x_1 - x_0
  // y_0 = grad f(x_1) - grad f(x_0)

  if (DEBUG_LBFGS) {
    log.info(
      "Starting lbfgs calculation with xs",
      xs,
      "gradfxs",
      gradfxs,
      "lbfgs params",
      lbfgsInfo
    );
  }

  if (lbfgsInfo.numUnconstrSteps === 0) {
    // Initialize state
    // Perform normal gradient descent on first step
    // Store x_k, grad f(x_k) so we can compute s_k, y_k on next step

    return {
      gradfxsPreconditioned: gradfxs,
      updatedLbfgsInfo: {
        ...lbfgsInfo,
        lastState: { tag: "Just" as const, contents: colVec(xs) },
        lastGrad: { tag: "Just" as const, contents: colVec(gradfxs) },
        s_list: [],
        y_list: [],
        numUnconstrSteps: 1,
      },
    };
  } else if (
    lbfgsInfo.lastState.tag === "Just" &&
    lbfgsInfo.lastGrad.tag === "Just"
  ) {
    // Our current step is k; the last step is km1 (k_minus_1)
    const x_k = colVec(xs);
    const grad_fx_k = colVec(gradfxs);

    const km1 = lbfgsInfo.numUnconstrSteps;
    const x_km1 = lbfgsInfo.lastState.contents;
    const grad_fx_km1 = lbfgsInfo.lastGrad.contents;
    const ss_km2 = lbfgsInfo.s_list;
    const ys_km2 = lbfgsInfo.y_list;

    // Compute s_{k-1} = x_k - x_{k-1} and y_{k-1} = (analogous with grads)
    // Unlike Nocedal, compute the difference vectors first instead of last (same result, just a loop rewrite)
    // Use the updated {s_i} and {y_i}. (If k < m, this reduces to normal BFGS, i.e. we use all the vectors so far)
    // Newest vectors added to front

    const s_km1 = x_k.matSub(x_km1);
    const y_km1 = grad_fx_k.matSub(grad_fx_km1);

    // The limited-memory part: drop stale vectors
    // Haskell `ss` -> JS `ss_km2`; Haskell `ss'` -> JS `ss_km1`
    const ss_km1 = _.take([s_km1].concat(ss_km2), lbfgsInfo.memSize);
    const ys_km1 = _.take([y_km1].concat(ys_km2), lbfgsInfo.memSize);
    const gradPreconditioned = lbfgsInner(grad_fx_k, ss_km1, ys_km1);

    // Reset L-BFGS if the result is not a descent direction, and use steepest descent direction
    // https://github.com/JuliaNLSolvers/Optim.jl/issues/143
    // https://github.com/JuliaNLSolvers/Optim.jl/pull/144
    // A descent direction is a vector p s.t. <p `dot` grad_fx_k> < 0
    // If P is a positive definite matrix, then p = -P grad f(x) is a descent dir at x
    const descentDirCheck = -1.0 * dotVec(gradPreconditioned, grad_fx_k);

    if (descentDirCheck > 0.0) {
      log.info(
        "L-BFGS did not find a descent direction. Resetting correction vectors.",
        lbfgsInfo
      );
      return {
        gradfxsPreconditioned: gradfxs,
        updatedLbfgsInfo: {
          ...lbfgsInfo,
          lastState: { tag: "Just" as const, contents: x_k },
          lastGrad: { tag: "Just" as const, contents: grad_fx_k },
          s_list: [],
          y_list: [],
          numUnconstrSteps: 1,
        },
      };
    }

    // Found a direction; update the state
    // TODO: check the curvature condition y_k^T s_k > 0 (8.7) (Nocedal 201)
    // https://github.com/JuliaNLSolvers/Optim.jl/issues/26
    if (DEBUG_LBFGS) {
      log.info("Descent direction found.", vecList(gradPreconditioned));
    }

    return {
      gradfxsPreconditioned: vecList(gradPreconditioned),
      updatedLbfgsInfo: {
        ...lbfgsInfo,
        lastState: { tag: "Just" as const, contents: x_k },
        lastGrad: { tag: "Just" as const, contents: grad_fx_k },
        s_list: ss_km1,
        y_list: ys_km1,
        numUnconstrSteps: km1 + 1,
      },
    };
  } else {
    log.info("State:", lbfgsInfo);
    throw Error("Invalid L-BFGS state");
  }
};

const minimize = (
  xs0: number[],
  f: (zs: number[]) => number,
  gradf: (zs: number[]) => number[],
  lbfgsInfo: LbfgsParams,
  varyingPaths: string[],
  numSteps: number
): OptInfo => {
  // TODO: Do a UO convergence check here? Since the EP check is tied to the render cycle...

  log.info("-------------------------------------");
  log.info("minimize, num steps", numSteps);

  // (10,000 steps / 100ms) * (10 ms / s) (???) = 100k steps/s (on this simple problem (just `sameCenter` or just `contains`, with no line search, and not sure about mem use)
  // this is just a factor of 5 slowdown over the compiled energy function

  let xs = [...xs0]; // Don't use xs
  let fxs = 0.0;
  let gradfxs = repeat(xs0.length, 0);
  let gradientPreconditioned = [...gradfxs];
  let normGradfxs = 0.0;
  let i = 0;
  let t = 0.0001; // NOTE: This const setting will not necessarily work well for a given opt problem.
  let failed = false;

  let newLbfgsInfo = { ...lbfgsInfo };

  while (i < numSteps) {
    if (containsNaN(xs)) {
      log.info("xs", xs);
      throw Error("NaN in xs");
    }
    fxs = f(xs);
    gradfxs = gradf(xs);
    if (containsNaN(gradfxs)) {
      log.info("gradfxs", gradfxs);
      throw Error("NaN in gradfxs");
    }

    const { gradfxsPreconditioned, updatedLbfgsInfo } = lbfgs(
      xs,
      gradfxs,
      newLbfgsInfo
    );
    newLbfgsInfo = updatedLbfgsInfo;
    gradientPreconditioned = gradfxsPreconditioned;

    // Don't take the Euclidean norm. According to Boyd (485), we should use the Newton descent check, with the norm of the gradient pulled back to the nicer space.
    normGradfxs = dot(gradfxs, gradfxsPreconditioned);

    if (BREAK_EARLY && unconstrainedConverged2(normGradfxs)) {
      // This is on the original gradient, not the preconditioned one
      log.info(
        "descent converged early, on step",
        i,
        "of",
        numSteps,
        "(per display cycle); stopping early"
      );
      break;
    }

    if (USE_LINE_SEARCH) {
      t = awLineSearch2(xs, f, gradf, gradfxsPreconditioned, fxs); // The search direction is conditioned (here, by an approximation of the inverse of the Hessian at the point)
    }

    const normGrad = normList(gradfxs);

    if (DEBUG_GRAD_DESCENT) {
      log.info("-----");
      log.info("i", i);
      log.info("num steps per display cycle", numSteps);
      log.info("input (xs):", xs);
      log.info("energy (f(xs)):", fxs);
      log.info("grad (grad(f)(xs)):", gradfxs);
      log.info("|grad f(x)|:", normGrad);
      log.info("t", t, "use line search:", USE_LINE_SEARCH);
    }

    if (Number.isNaN(fxs) || Number.isNaN(normGrad)) {
      log.info("-----");

      const pathMap = _.zip(varyingPaths, xs, gradfxs) as [
        string,
        number,
        number
      ][];

      log.info("[varying paths, current val, gradient of val]", pathMap);

      for (const [name, x, dx] of pathMap) {
        if (Number.isNaN(dx)) {
          log.info("NaN in varying val's gradient", name, "(current val):", x);
        }
      }

      log.info("i", i);
      log.info("num steps per display cycle", numSteps);
      log.info("input (xs):", xs);
      log.info("energy (f(xs)):", fxs);
      log.info("grad (grad(f)(xs)):", gradfxs);
      log.info("|grad f(x)|:", normGrad);
      log.info("t", t, "use line search:", USE_LINE_SEARCH);
      failed = true;
      break;
      //throw Error("NaN reached in optimization energy or gradient norm!");
    }

    xs = xs.map((x, j) => x - t * gradfxsPreconditioned[j]); // The GD update uses the conditioned search direction, as well as the timestep found by moving along it
    i++;
  }

  // TODO: Log stats for last one?

  return {
    xs,
    energyVal: fxs,
    normGrad: normGradfxs,
    newLbfgsInfo,
    gradient: gradfxs,
    gradientPreconditioned,
    failed: failed,
  };
};

/**
 * Generate an energy function from the current state (using VarADs only)
 *
 * @param {State} state
 * @returns a function that takes in a list of `VarAD`s and return a `Scalar`
 */
export const evalEnergyOnCustom = (state: State) => {
  // TODO: types
  return (...xsVars: VarAD[]): any => {
    // TODO: Could this line be causing a memory leak?
    const { objFns, constrFns, varyingPaths } = state;

    // Clone the translation to use in the `evalFns` top-level calls, because they mutate the translation while interpreting the energy function in order to cache/reuse VarAD (computation) results
    // Note that we have to do a "round trip" on the translation types, from VarAD to number to VarAD, to clear the computational graph of the VarADs. Otherwise, there may be cycles in the translation (since 1) we run `evalShapes` in `processData`, which mutates the VarADs, and 2) the computational graph contains DAGs and stores both parent and child pointers). Cycles in the translation cause `clone` to be very slow, and anyway, the VarADs should be "fresh" since the point of this function is to build the comp graph from scratch by interpreting the translation.
    const translationInit = makeTranslationDifferentiable(
      clone(makeTranslationNumeric(state.translation))
    );

    const varyingMapList = _.zip(varyingPaths, xsVars) as [Path, VarAD][];
    // Insert varying vals into translation (e.g. VectorAccesses of varying vals are found in the translation, although I guess in practice they should use varyingMap)
    const translation = insertVaryings(translationInit, varyingMapList);

    // construct a new varying map
    const varyingMap = genPathMap(varyingPaths, xsVars) as VaryMap<VarAD>;

    // NOTE: This will mutate the var inputs
    const objEvaled = evalFns(objFns, translation, varyingMap);
    const constrEvaled = evalFns(constrFns, translation, varyingMap);

    const objEngs: VarAD[] = objEvaled.map((o) => applyFn(o, objDict));
    const constrEngs: VarAD[] = constrEvaled.map((c) =>
      fns.toPenalty(applyFn(c, constrDict))
    );

    // Note there are two energies, each of which does NOT know about its children, but the root nodes should now have parents up to the objfn energies. The computational graph can be seen in inspecting varyingValuesTF's parents
    // The energies are in the val field of the results (w/o grads)
    // log.info("objEngs", objFns, objEngs);
    // log.info("vars", varyingValuesTF);

    // TODO make this check more robust to empty lists of objectives/constraints
    if (!objEngs[0] && !constrEngs[0]) {
      log.info("WARNING: no objectives and no constraints");
    }

    // This is fixed during the whole optimization
    const constrWeightNode = varOf(
      constraintWeight,
      String(constraintWeight),
      "constraintWeight"
    );

    // This changes with the EP round, gets bigger to weight the constraints
    // Therefore it's marked as an input to the generated objective function, which can be partially applied with the ep weight (-1 is an index; means it appears as the first argument)
    const epWeightNode = markInput(
      varOf(state.params.weight, String(state.params.weight), "epWeight"),
      -1
    );

    const objEng: VarAD = ops.vsum(objEngs);
    const constrEng: VarAD = ops.vsum(constrEngs);
    // F(x) = o(x) + c0 * penalty * c(x)
    const overallEng: VarAD = add(
      objEng,
      mul(constrEng, mul(constrWeightNode, epWeightNode))
    );

    // NOTE: This is necessary because we have to state the seed for the autodiff, which is the last output
    overallEng.gradVal = { tag: "Just" as const, contents: 1.0 };
    log.info("overall eng from custom AD", overallEng, overallEng.val);

    return {
      energyGraph: overallEng,
      constrWeightNode,
      epWeightNode,
    };
  };
};

export const genOptProblem = (state: State): State => {
  const xs: number[] = state.varyingValues;
  log.trace("step newIter, xs", xs);

  // if (!state.params.functionsCompiled) {
  // TODO: Doesn't reuse compiled function for now (since caching function in App currently does not work)
  // Compile objective and gradient
  log.info("Compiling objective and gradient");

  // `overallEnergy` is a partially applied function, waiting for an input.
  // When applied, it will interpret the energy via lookups on the computational graph
  // TODO: Could save the interpreted energy graph across amples
  const overallObjective = evalEnergyOnCustom(state);
  const xsVars: VarAD[] = makeADInputVars(xs);
  const res = overallObjective(...xsVars); // Note: `overallObjective` mutates `xsVars`
  // `energyGraph` is a VarAD that is a handle to the top of the graph

  log.info("interpreted energy graph", res.energyGraph);
  log.info("input vars", xsVars);

  const weightInfo = {
    // TODO: factor out
    constrWeightNode: res.constrWeightNode,
    epWeightNode: res.epWeightNode,
    constrWeight: constraintWeight,
    epWeight: initConstraintWeight,
  };

  const { graphs, f, gradf } = energyAndGradCompiled(
    xs,
    xsVars,
    res.energyGraph,
    { tag: "Just", contents: weightInfo }
  );

  eig.GC.flush(); // Clear allocated matrix, vector objects in L-BFGS params

  const newParams: Params = {
    ...state.params,
    xsVars,

    lastGradient: repeat(xs.length, 0),
    lastGradientPreconditioned: repeat(xs.length, 0),

    graphs,
    objective: f,
    gradient: gradf,

    functionsCompiled: true,

    currObjective: f(initConstraintWeight),
    currGradient: gradf(initConstraintWeight),

    energyGraph: res.energyGraph,
    constrWeightNode: res.constrWeightNode,
    epWeightNode: res.epWeightNode,
    weight: initConstraintWeight,
    UOround: 0,
    EPround: 0,
    optStatus: "UnconstrainedRunning",

    lbfgsInfo: defaultLbfgsParams,
  };

  return { ...state, params: newParams };
};

// Eval a single function on the state (using VarADs). Based off of `evalEnergyOfCustom` -- see that function for comments.
const evalFnOn = (fn: Fn, s: State) => {
  const dict = fn.optType === "ObjFn" ? objDict : constrDict;

  return (...xsVars: VarAD[]): VarAD => {
    const { varyingPaths } = s;

    const translationInit = makeTranslationDifferentiable(
      clone(makeTranslationNumeric(s.translation))
    );

    const varyingMapList = _.zip(varyingPaths, xsVars) as [Path, VarAD][];
    const translation = insertVaryings(translationInit, varyingMapList);
    const varyingMap = genPathMap(varyingPaths, xsVars) as VaryMap<VarAD>;

    // NOTE: This will mutate the var inputs
    const fnArgsEvaled: FnDone<VarAD> = evalFn(fn, translation, varyingMap);
    const fnEnergy: VarAD = applyFn(fnArgsEvaled, dict);

    return fnEnergy;
  };
};

// For a given objective or constraint, precompile it and its gradient, without any weights. (variation on `genOptProblem`)
const genFn = (fn: Fn, s: State): FnCached => {
  const xs: number[] = clone(s.varyingValues);

  const overallObjective = evalFnOn(fn, s);
  const xsVars: VarAD[] = makeADInputVars(xs);
  const energyGraph: VarAD = overallObjective(...xsVars); // Note: `overallObjective` mutates `xsVars`

  const weightInfo: MaybeVal<WeightInfo> = { tag: "Nothing" };

  const { graphs, f, gradf } = energyAndGradCompiled(
    xs,
    xsVars,
    energyGraph,
    weightInfo
  );

  // Note this throws away the energy/gradient graphs (`VarAD`s). Presumably not needed?
  return { f, gradf };
};

// For each objective and constraint, precompile it and its gradient and cache it in the state.
export const genFns = (s: State): State => {
  const p = s.params;
  const objCache = {};
  const constrCache = {};

  for (const f of s.objFns) {
    objCache[prettyPrintFn(f)] = genFn(f, s);
  }

  for (const f of s.constrFns) {
    constrCache[prettyPrintFn(f)] = genFn(f, s);
  }

  p.objFnCache = objCache;
  p.constrFnCache = constrCache;

  return s;
};

const containsNaN = (numberList: number[]): boolean => {
  for (var n in numberList) {
    if (Number.isNaN(n)) {
      return true;
    }
  }
  return false;
};
