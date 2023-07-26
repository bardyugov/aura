import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserAbstractReposiotory } from "src/domain/repositories/user-repository/user-repository.abstract";
import { BcryptAbstractAdapter } from "src/domain/adapters/bcrypt-adapter/bcrypt.adapter";
import { TokenAbstractRepository } from "src/domain/repositories/token-repository/token-repository.adapter";
import { JwtAbstractAdapter } from "src/domain/adapters/jwt-adapter/jwt.adapter";
import { EmploeeEntity } from "@prisma/client";
import { v4 as uuidv4 } from 'uuid';
import { EmploeeRegisterDto } from "src/infrastructure/controllers/auth/dto/emploee.register.dto";
import { ResultAuthorization } from "../response-data/response.interfaces";
import { EmploeeLoginDto } from "src/infrastructure/controllers/auth/dto/emploee.login.dto";

export class AuthUseCase {
  constructor(
    private readonly UserRepository: UserAbstractReposiotory,
    private readonly TokenRepository: TokenAbstractRepository,
    private readonly bcrypt: BcryptAbstractAdapter,
    private readonly JwtService: JwtAbstractAdapter<EmploeeEntity>,
    private readonly config: ConfigService
  ) { };

  private generateTokens(user: EmploeeEntity): [string, string] {
    const access = this.JwtService.create(user, this.config.get<number>("TIME_ACCESS"));
    const refresh = this.JwtService.create(user, this.config.get<number>("TIME_REFRESH"));
    return [access, refresh];
  };

  private generateHeader(token: string): string {
    return `Refresh=${token}; HttpOnly; Path=/; Max-Age=${this.config.get<number>("TIME_REFRESH")}`
  };

  public async registerEmploee(data: EmploeeRegisterDto): Promise<ResultAuthorization.IResultRegister> {
    console.log(await this.bcrypt.hash("123456789"))
    const isExistEmploee = await this.UserRepository.findUniqueBySurname(data.surname);
    if (isExistEmploee) throw new BadRequestException('This emploee already exist');
    const createdEmploee = await this.UserRepository.create({ ...data, jobTitle: 'EMPLOEE' });
    const [access, refresh] = this.generateTokens(createdEmploee);
    console.log(access);
    await this.TokenRepository.createWithoutRelationUser(refresh, createdEmploee.id);
    const header = this.generateHeader(refresh);
    const link = uuidv4();
    return { header, link };
  };

  public async login(data: EmploeeLoginDto): Promise<ResultAuthorization.IResultLogin> {
    const isExistUser = await this.UserRepository.findUniqueBySurname(data.surname);
    if (!isExistUser) throw new BadRequestException('You unaftorized');
    const isPassword = await this.bcrypt.unHash(data.password, isExistUser.password);
    if (!isPassword) throw new BadRequestException('Invalid password');
    const [access, refresh] = this.generateTokens(isExistUser);
    const isExistToken = await this.TokenRepository.getByUserId(isExistUser.id);
    if (isExistToken) await this.TokenRepository.update(isExistToken.id, refresh);
    else await this.TokenRepository.createWithoutRelationUser(refresh, isExistUser.id);
    const header = this.generateHeader(refresh);
    return { user: isExistUser, access, header }
  };

  public async refresh(token: string): Promise<ResultAuthorization.IResultLogin> {
    const payload = this.JwtService.validateToken(token);
    if (!payload) throw new UnauthorizedException();
    const tokenWithRelation = await this.TokenRepository.getByUserId(payload.id);
    if (!tokenWithRelation) throw new UnauthorizedException();
    const user = await this.UserRepository.getById(payload.id);
    const [access, refresh] = this.generateTokens(user);
    await this.TokenRepository.update(tokenWithRelation.id, refresh);
    const header = this.generateHeader(refresh);
    return { user, access, header};
  };

  public async logout(id: string): Promise<ResultAuthorization.IResultLogout> {
    const token = await this.TokenRepository.getByUserId(id);
    if (!token) {
      throw new BadRequestException("You are already logout");
    }
    await this.TokenRepository.delete(token.id);
    return { message: "Logout success" };
  };
};