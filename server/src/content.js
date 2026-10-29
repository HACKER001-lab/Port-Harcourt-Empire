// Server-defined activity catalogue. The client picks a kind; the server owns
// duration, cost, requirements and reward. Unknown kinds are rejected.

const ACTIVITIES = {
  delivery_shift: {
    title: "Delivery shift",
    category: "work",
    durationSeconds: 90,
    energyCost: 8,
    moneyCost: 0,
    rewardMoney: 900,
    rewardFame: 0,
    rewardSkill: 0,
    rewardIq: 0,
    minActingSkill: 0,
    minIq: 0,
    minEnergy: 10
  },
  studio_shift: {
    title: "Studio shift",
    category: "work",
    durationSeconds: 150,
    energyCost: 15,
    moneyCost: 0,
    rewardMoney: 2600,
    rewardFame: 1,
    rewardSkill: 0,
    rewardIq: 0,
    minActingSkill: 5,
    minIq: 0,
    minEnergy: 20
  },
  training: {
    title: "Acting training",
    category: "training",
    durationSeconds: 60,
    energyCost: 10,
    moneyCost: 400,
    rewardMoney: 0,
    rewardFame: 0,
    rewardSkill: 1,
    rewardIq: 0,
    minActingSkill: 0,
    minIq: 0,
    minEnergy: 12
  },
  course: {
    title: "Evening course",
    category: "education",
    durationSeconds: 240,
    energyCost: 8,
    moneyCost: 5000,
    rewardMoney: 0,
    rewardFame: 0,
    rewardSkill: 0,
    rewardIq: 2,
    minActingSkill: 0,
    minIq: 0,
    minEnergy: 10
  },
  rest: {
    title: "Rest at home",
    category: "recovery",
    durationSeconds: 45,
    energyCost: 0,
    moneyCost: 0,
    rewardMoney: 0,
    rewardFame: 0,
    rewardSkill: 0,
    rewardIq: 0,
    rewardEnergy: 25,
    minActingSkill: 0,
    minIq: 0,
    minEnergy: 0
  }
};

const AVATARS = ["🌟", "🎬", "🎭", "🎧", "🦋", "🌹", "🔥", "💎", "🏆", "🌊"];

module.exports = { ACTIVITIES, AVATARS };
