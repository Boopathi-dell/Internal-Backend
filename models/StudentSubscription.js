const mongoose = require('mongoose');

const studentSubscriptionSchema = new mongoose.Schema({
  regNo: { type: String, required: true },
  subscription: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Compound index so that a user doesn't save the exact same subscription twice
studentSubscriptionSchema.index({ regNo: 1, "subscription.endpoint": 1 }, { unique: true });

module.exports = mongoose.model("StudentSubscription", studentSubscriptionSchema);
