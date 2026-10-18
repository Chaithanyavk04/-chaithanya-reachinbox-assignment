export const up = (pgm) => {
  pgm.createTable("emails", {
    id: {
      type: "bigserial",
      primaryKey: true
    },
    user_id: {
      type: "text"
    },
    sender_email: {
      type: "text",
      notNull: true
    },
    recipient_email: {
      type: "text",
      notNull: true
    },
    subject: {
      type: "text",
      notNull: true
    },
    body: {
      type: "text",
      notNull: true
    },
    scheduled_at: {
      type: "timestamptz",
      notNull: true
    },
    sent_at: {
      type: "timestamptz"
    },
    status: {
      type: "text",
      notNull: true,
      default: "scheduled",
      check: "status IN ('scheduled', 'processing', 'sent', 'failed')"
    },
    idempotency_key: {
      type: "text",
      unique: true
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()")
    }
  });

  pgm.createIndex("emails", ["status", "scheduled_at"]);
  pgm.createIndex("emails", ["recipient_email"]);
};

export const down = (pgm) => {
  pgm.dropTable("emails");
};
