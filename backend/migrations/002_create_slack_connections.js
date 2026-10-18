
export const up = (pgm) => {
  pgm.createTable("slack_connections", {
    id: {
      type: "bigserial",
      primaryKey: true,
    },
    user_id: {
      type: "text",
      notNull: true,
      unique: true,
    },
    slack_team_id: {
      type: "text",
      notNull: true,
    },
    slack_team_name: {
      type: "text",
    },
    slack_user_id: {
      type: "text",
    },
    access_token: {
      type: "text",
      notNull: true,
    },
    bot_user_id: {
      type: "text",
    },
    connected_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.createIndex("slack_connections", ["slack_team_id"]);
};

export const down = (pgm) => {
  pgm.dropTable("slack_connections");
};
