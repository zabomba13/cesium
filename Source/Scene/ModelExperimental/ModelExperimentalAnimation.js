import defaultValue from "../Core/defaultValue.js";
import Event from "../Core/Event.js";
import JulianDate from "../Core/JulianDate.js";
import ModelAnimationLoop from "./ModelAnimationLoop.js";
import ModelAnimationState from "./ModelAnimationState.js";
import ModelExperimentalAnimationChannel from "../ModelExperimental/ModelExperimentalAnimationChannel.js";

/**
 * An active animation derived from a glTF asset. An active animation is an
 * animation that is either currently playing or scheduled to be played due to
 * being added to a model's {@link ModelExperimentalAnimationCollection}. An active animation
 * is an instance of an animation; for example, there can be multiple active
 * animations for the same glTF animation, each with a different start time.
 * <p>
 * Create this by calling {@link ModelExperimentalAnimationCollection#add}.
 * </p>
 *
 * @alias ModelExperimentalAnimation
 * @internalConstructor
 * @class
 *
 * @see ModelExperimentalAnimationCollection#add
 */
function ModelExperimentalAnimation(model, animation, options) {
  this._animation = animation;
  this._name = defaultValue(animation.name, animation.index);
  this._runtimeChannels = undefined;

  this._startTime = JulianDate.clone(options.startTime);
  this._delay = defaultValue(options.delay, 0.0); // in seconds
  this._stopTime = options.stopTime;

  /**
   * When <code>true</code>, the animation is removed after it stops playing.
   * This is slightly more efficient that not removing it, but if, for example,
   * time is reversed, the animation is not played again.
   *
   * @type {Boolean}
   * @default false
   */
  this.removeOnStop = defaultValue(options.removeOnStop, false);
  this._multiplier = defaultValue(options.multiplier, 1.0);
  this._reverse = defaultValue(options.reverse, false);
  this._loop = defaultValue(options.loop, ModelAnimationLoop.NONE);

  /**
   * The event fired when this animation is started.  This can be used, for
   * example, to play a sound or start a particle system, when the animation starts.
   * <p>
   * This event is fired at the end of the frame after the scene is rendered.
   * </p>
   *
   * @type {Event}
   * @default new Event()
   *
   * @example
   * animation.start.addEventListener(function(model, animation) {
   *   console.log('Animation started: ' + animation.name);
   * });
   */
  this.start = new Event();

  /**
   * The event fired when on each frame when this animation is updated.  The
   * current time of the animation, relative to the glTF animation time span, is
   * passed to the event, which allows, for example, starting new animations at a
   * specific time relative to a playing animation.
   * <p>
   * This event is fired at the end of the frame after the scene is rendered.
   * </p>
   *
   * @type {Event}
   * @default new Event()
   *
   * @example
   * animation.update.addEventListener(function(model, animation, time) {
   *   console.log('Animation updated: ' + animation.name + '. glTF animation time: ' + time);
   * });
   */
  this.update = new Event();

  /**
   * The event fired when this animation is stopped.  This can be used, for
   * example, to play a sound or start a particle system, when the animation stops.
   * <p>
   * This event is fired at the end of the frame after the scene is rendered.
   * </p>
   *
   * @type {Event}
   * @default new Event()
   *
   * @example
   * animation.stop.addEventListener(function(model, animation) {
   *   console.log('Animation stopped: ' + animation.name);
   * });
   */
  this.stop = new Event();

  this._state = ModelAnimationState.STOPPED;

  // Set during animation update
  this._computedStartTime = undefined;
  this._duration = undefined;

  // To avoid allocations in ModelExperimentalAnimationCollection.update
  const that = this;
  this._raiseStartEvent = function () {
    that.start.raiseEvent(model, that);
  };
  this._updateEventTime = 0.0;
  this._raiseUpdateEvent = function () {
    that.update.raiseEvent(model, that, that._updateEventTime);
  };
  this._raiseStopEvent = function () {
    that.stop.raiseEvent(model, that);
  };

  /**
   * A reference to the {@link ModelExperimental} that owns this scene graph.
   *
   * @type {ModelExperimental}
   * @readonly
   *
   * @private
   */
  this._model = model;

  initialize(this);
}

// TODO: write initialize function that builds animation from samplers and channels
// see ModelAnimationCache

Object.defineProperties(ModelExperimentalAnimation.prototype, {
  /**
   * The glTF animation.
   *
   * @memberof ModelExperimentalAnimation.prototype
   *
   * @type {ModelComponents.Animation}
   * @readonly
   *
   * @private
   */
  animation: {
    get: function () {
      return this._animation;
    },
  },
  /**
   * The name that identifies this animation in the model.
   *
   * @memberof ModelExperimentalAnimation.prototype
   *
   * @type {String}
   * @readonly
   */
  name: {
    get: function () {
      return this._name;
    },
  },

  /**
   * The runtime animation channels for this animation.
   *
   * @memberof ModelExperimentalAnimation.prototype
   *
   * @type {ModelExperimentalAnimationChannel[]}
   * @readonly
   *
   * @private
   */
  runtimeChannels: {
    get: function () {
      return this._runtimeChannels;
    },
  },

  /**
   * The scene time to start playing this animation. When this is <code>undefined</code>,
   * the animation starts at the next frame.
   *
   * @memberof ModelExperimentalAnimation.prototype
   *
   * @type {JulianDate}
   * @readonly
   *
   * @default undefined
   */
  startTime: {
    get: function () {
      return this._startTime;
    },
  },

  /**
   * The delay, in seconds, from {@link ModelExperimentalAnimation#startTime} to start playing.
   *
   * @memberof ModelExperimentalAnimation.prototype
   *
   * @type {Number}
   * @readonly
   *
   * @default undefined
   */
  delay: {
    get: function () {
      return this._delay;
    },
  },

  /**
   * The scene time to stop playing this animation. When this is <code>undefined</code>,
   * the animation is played for its full duration and perhaps repeated depending on
   * {@link ModelExperimentalAnimation#loop}.
   *
   * @memberof ModelExperimentalAnimation.prototype
   *
   * @type {JulianDate}
   * @readonly
   *
   * @default undefined
   */
  stopTime: {
    get: function () {
      return this._stopTime;
    },
  },
  /**
   * Values greater than <code>1.0</code> increase the speed that the animation is played relative
   * to the scene clock speed; values less than <code>1.0</code> decrease the speed.  A value of
   * <code>1.0</code> plays the animation at the speed in the glTF animation mapped to the scene
   * clock speed.  For example, if the scene is played at 2x real-time, a two-second glTF animation
   * will play in one second even if <code>multiplier</code> is <code>1.0</code>.
   *
   * @memberof ModelExperimentalAnimation.prototype
   *
   * @type {Number}
   * @readonly
   *
   * @default 1.0
   */
  multiplier: {
    get: function () {
      return this._multiplier;
    },
  },

  /**
   * When <code>true</code>, the animation is played in reverse.
   *
   * @memberof ModelExperimentalAnimation.prototype
   *
   * @type {Boolean}
   * @readonly
   *
   * @default false
   */
  reverse: {
    get: function () {
      return this._reverse;
    },
  },

  /**
   * Determines if and how the animation is looped.
   *
   * @memberof ModelExperimentalAnimation.prototype
   *
   * @type {ModelAnimationLoop}
   * @readonly
   *
   * @default {@link ModelAnimationLoop.NONE}
   */
  loop: {
    get: function () {
      return this._loop;
    },
  },
});

function initialize(runtimeAnimation) {
  const sceneGraph = runtimeAnimation._model.sceneGraph;
  const animation = runtimeAnimation._animation;
  const channels = animation.channels;
  const length = channels.length;

  const runtimeChannels = new Array(length);
  for (let i = 0; i < length; i++) {
    const channel = channels[i];
    const nodeIndex = channel.node.index;
    const runtimeNode = sceneGraph._runtimeNodes[nodeIndex];

    const runtimeChannel = new ModelExperimentalAnimationChannel({
      channel: channel,
      runtimeAnimation: runtimeAnimation,
      runtimeNode: runtimeNode,
    });

    runtimeChannels[i] = runtimeChannel;
  }

  runtimeAnimation._runtimeChannels = runtimeChannels;
}

ModelExperimentalAnimation.prototype.animate = function (time) {
  const runtimeChannels = this._runtimeChannels;
  const length = runtimeChannels.length;
  for (let i = 0; i < length; i++) {
    runtimeChannels[i].animate(time);
  }
};

export default ModelExperimentalAnimation;
