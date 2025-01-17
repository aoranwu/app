import {
  Column,
  ForeignKey,
  Table,
  BelongsTo,
  Model,
  PrimaryKey
} from "sequelize-typescript";
import { STRING } from "sequelize";
import Transcript from "./Transcript";

@Table({
  paranoid: true,
  indexes: [{
    unique: true,
    fields: ['transcriptId', 'summaryKey']
  }]
})
class Summary extends Model {
  @PrimaryKey
  @ForeignKey(() => Transcript)
  @Column(STRING)
  transcriptId: string;

  @BelongsTo(() => Transcript)
  transcript: Transcript;

  @PrimaryKey
  @Column(STRING)
  // TODO: rename to `key`
  summaryKey: string;

  @Column(STRING(1 * 1024 * 1024))
  // TODO: rename to `text`
  summary: string;
}

export default Summary;
